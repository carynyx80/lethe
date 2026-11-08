// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title LetheAuction — sealed-order, uniform-price batch auction for one token pair.
/// @notice Time is split into fixed rounds. In the commit phase traders submit only a hash of
///         their order, so nobody (including the sequencer) can see side, price or size. In the
///         reveal phase anyone holding the preimage reveals it and the order's funds are locked.
///         After the round ends anyone may settle it: every filled order trades at one clearing
///         price that maximises matched volume.
/// @dev    No owner, no admin, no upgrade path, no pause. Parameters are immutable.
///         Funds live in an internal vault (`balanceOf`) and are withdrawable whenever not locked
///         in a revealed, unsettled order.
contract LetheAuction is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    enum Phase {
        Pending, // round has not started
        Commit, // accepting sealed orders
        Reveal, // accepting reveals
        Settleable, // ended, waiting for settle()
        Settled
    }

    enum Status {
        None,
        Committed,
        Revealed,
        Cancelled
    }

    struct Order {
        address trader; //    slot 0 (20 bytes)
        Status status; //              (1 byte)
        bool isBuy; //                 (1 byte)
        uint128 price; //     slot 1: quote base-units per 1e18 base base-units
        uint128 amount; //            base base-units
        bytes32 commitment; // slot 2
    }

    struct RoundResult {
        bool settled;
        uint128 price; // 0 when nothing traded
        uint128 volume; // base base-units matched
    }

    // ------------------------------------------------------------------ constants / immutables

    uint256 public constant PRICE_SCALE = 1e18;

    IERC20 public immutable baseToken;
    IERC20 public immutable quoteToken;
    /// @notice Receives slashed bonds and rounding dust. Has no other power.
    address public immutable treasury;
    uint256 public immutable genesis;
    uint256 public immutable commitDuration;
    uint256 public immutable revealDuration;
    /// @notice Quote-token bond taken at commit, returned on reveal or cancel, slashed if never revealed.
    uint256 public immutable bond;
    uint256 public immutable minBaseAmount;
    uint256 public immutable maxOrdersPerRound;

    // ------------------------------------------------------------------ storage

    /// @notice Free (withdrawable) vault balance: trader => token => amount.
    mapping(address => mapping(address => uint256)) public balanceOf;
    mapping(uint256 => Order[]) internal _orders;
    mapping(uint256 => RoundResult) public results;

    // ------------------------------------------------------------------ events

    event Deposited(address indexed trader, address indexed token, uint256 amount);
    event Withdrawn(address indexed trader, address indexed token, uint256 amount);
    event Committed(uint256 indexed round, uint256 indexed index, address indexed trader, bytes32 commitment);
    event Cancelled(uint256 indexed round, uint256 indexed index, address indexed trader);
    event Revealed(
        uint256 indexed round, uint256 indexed index, address indexed trader, bool isBuy, uint256 price, uint256 amount
    );
    event Filled(
        uint256 indexed round,
        uint256 indexed index,
        address indexed trader,
        bool isBuy,
        uint256 baseFilled,
        uint256 quoteAmount
    );
    event BondSlashed(uint256 indexed round, uint256 indexed index, address indexed trader, uint256 amount);
    event RoundSettled(uint256 indexed round, uint256 price, uint256 volume, uint256 orders);

    // ------------------------------------------------------------------ errors

    error UnsupportedToken();
    error ZeroAmount();
    error InsufficientBalance();
    error WrongPhase(Phase actual);
    error RoundFull();
    error NotTrader();
    error BadStatus();
    error CommitmentMismatch();
    error InvalidOrder();
    error InvalidConfig();

    constructor(
        IERC20 baseToken_,
        IERC20 quoteToken_,
        address treasury_,
        uint256 genesis_,
        uint256 commitDuration_,
        uint256 revealDuration_,
        uint256 bond_,
        uint256 minBaseAmount_,
        uint256 maxOrdersPerRound_
    ) {
        if (
            address(baseToken_) == address(0) || address(quoteToken_) == address(0) || baseToken_ == quoteToken_
                || treasury_ == address(0) || commitDuration_ == 0 || revealDuration_ == 0 || minBaseAmount_ == 0
                || maxOrdersPerRound_ == 0 || maxOrdersPerRound_ > 200
        ) revert InvalidConfig();
        baseToken = baseToken_;
        quoteToken = quoteToken_;
        treasury = treasury_;
        genesis = genesis_;
        commitDuration = commitDuration_;
        revealDuration = revealDuration_;
        bond = bond_;
        minBaseAmount = minBaseAmount_;
        maxOrdersPerRound = maxOrdersPerRound_;
    }

    // ================================================================== vault

    function deposit(address token, uint256 amount) external nonReentrant {
        _deposit(token, amount);
    }

    /// @notice One-signature deposit for EIP-2612 tokens. A front-run permit is tolerated.
    function depositWithPermit(address token, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        try IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _deposit(token, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        _checkToken(token);
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender][token];
        if (bal < amount) revert InsufficientBalance();
        balanceOf[msg.sender][token] = bal - amount;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    function _deposit(address token, uint256 amount) internal {
        _checkToken(token);
        if (amount == 0) revert ZeroAmount();
        IERC20 t = IERC20(token);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = t.balanceOf(address(this)) - before; // credit what actually arrived
        if (received == 0) revert ZeroAmount();
        balanceOf[msg.sender][token] += received;
        emit Deposited(msg.sender, token, received);
    }

    function _checkToken(address token) internal view {
        if (token != address(baseToken) && token != address(quoteToken)) revert UnsupportedToken();
    }

    // ================================================================== timing

    function roundDuration() public view returns (uint256) {
        return commitDuration + revealDuration;
    }

    /// @notice Round whose commit or reveal phase contains `block.timestamp` (0 before genesis).
    function currentRound() public view returns (uint256) {
        if (block.timestamp < genesis) return 0;
        return (block.timestamp - genesis) / roundDuration();
    }

    function roundStart(uint256 round) public view returns (uint256) {
        return genesis + round * roundDuration();
    }

    function revealStart(uint256 round) public view returns (uint256) {
        return roundStart(round) + commitDuration;
    }

    function roundEnd(uint256 round) public view returns (uint256) {
        return roundStart(round) + roundDuration();
    }

    function phase(uint256 round) public view returns (Phase) {
        if (results[round].settled) return Phase.Settled;
        uint256 t = block.timestamp;
        if (t < roundStart(round)) return Phase.Pending;
        if (t < revealStart(round)) return Phase.Commit;
        if (t < roundEnd(round)) return Phase.Reveal;
        return Phase.Settleable;
    }

    // ================================================================== orders

    /// @notice Hash a trader must commit. Bound to chain, contract, round and trader so it cannot be replayed.
    function commitmentHash(
        uint256 round,
        address trader,
        bool isBuy,
        uint256 price,
        uint256 amount,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), round, trader, isBuy, price, amount, salt));
    }

    /// @notice Seal an order into the current round. Takes `bond` quote from the free balance.
    function commit(bytes32 commitment) external nonReentrant returns (uint256 round, uint256 index) {
        round = currentRound();
        Phase p = phase(round);
        if (p != Phase.Commit) revert WrongPhase(p);
        Order[] storage list = _orders[round];
        if (list.length >= maxOrdersPerRound) revert RoundFull();
        _debit(msg.sender, address(quoteToken), bond);
        index = list.length;
        list.push(
            Order({
                trader: msg.sender,
                status: Status.Committed,
                isBuy: false,
                price: 0,
                amount: 0,
                commitment: commitment
            })
        );
        emit Committed(round, index, msg.sender, commitment);
    }

    /// @notice Withdraw a sealed order while the commit phase is still open. Bond is returned.
    function cancel(uint256 round, uint256 index) external nonReentrant {
        Phase p = phase(round);
        if (p != Phase.Commit) revert WrongPhase(p);
        Order storage o = _orders[round][index];
        if (o.trader != msg.sender) revert NotTrader();
        if (o.status != Status.Committed) revert BadStatus();
        o.status = Status.Cancelled;
        balanceOf[msg.sender][address(quoteToken)] += bond;
        emit Cancelled(round, index, msg.sender);
    }

    /// @notice Reveal a sealed order. Callable by anyone holding the preimage (e.g. a gas-only
    ///         helper key), because the hash binds the trader and every order field.
    ///         Returns the bond and locks the order's funds from the trader's free balance.
    function reveal(uint256 round, uint256 index, bool isBuy, uint256 price, uint256 amount, bytes32 salt)
        external
        nonReentrant
    {
        Phase p = phase(round);
        if (p != Phase.Reveal) revert WrongPhase(p);
        Order storage o = _orders[round][index];
        if (o.status != Status.Committed) revert BadStatus();
        address trader = o.trader;
        if (commitmentHash(round, trader, isBuy, price, amount, salt) != o.commitment) revert CommitmentMismatch();
        if (price == 0 || price > type(uint128).max || amount < minBaseAmount || amount > type(uint128).max) {
            revert InvalidOrder();
        }

        balanceOf[trader][address(quoteToken)] += bond;
        if (isBuy) {
            uint256 lock = _buyLock(amount, price);
            if (lock == 0) revert InvalidOrder();
            _debit(trader, address(quoteToken), lock);
        } else {
            _debit(trader, address(baseToken), amount);
        }

        o.status = Status.Revealed;
        o.isBuy = isBuy;
        // forge-lint: disable-next-line(unsafe-typecast) -- price <= type(uint128).max checked above
        o.price = uint128(price);
        // forge-lint: disable-next-line(unsafe-typecast) -- amount <= type(uint128).max checked above
        o.amount = uint128(amount);
        emit Revealed(round, index, trader, isBuy, price, amount);
    }

    function _buyLock(uint256 amount, uint256 price) internal pure returns (uint256) {
        return Math.mulDiv(amount, price, PRICE_SCALE, Math.Rounding.Ceil);
    }

    function _debit(address who, address token, uint256 amount) internal {
        uint256 bal = balanceOf[who][token];
        if (bal < amount) revert InsufficientBalance();
        balanceOf[who][token] = bal - amount;
    }

    // ================================================================== settlement

    /// @notice Clear a finished round. Permissionless; each round settles once.
    function settle(uint256 round) external nonReentrant {
        Phase p = phase(round);
        if (p != Phase.Settleable) revert WrongPhase(p);

        Order[] storage list = _orders[round];
        uint256 n = list.length;
        Order[] memory os = new Order[](n);
        for (uint256 i; i < n; ++i) {
            os[i] = list[i];
        }

        (uint256 price, uint256 demand, uint256 supply) = _clearingPrice(os);
        uint256 volume = Math.min(demand, supply);

        uint256[] memory fills = new uint256[](n);
        if (volume > 0) _allocate(os, fills, price, volume, demand, supply);

        Totals memory t;
        for (uint256 i; i < n; ++i) {
            _applyOrder(round, i, os[i], fills[i], price, t);
        }

        // Buyers round up and sellers round down, so quoteIn >= quoteOut; dust goes to treasury.
        uint256 toTreasury = t.slashed + (t.quoteIn - t.quoteOut);
        if (toTreasury > 0) balanceOf[treasury][address(quoteToken)] += toTreasury;

        // Clearing price is one of the revealed uint128 prices (or their midpoint) and volume is bounded by
        // the sum of <= 200 uint128 amounts on the short side, which can exceed uint128 only in theory; clamp.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 vol128 = volume > type(uint128).max ? type(uint128).max : uint128(volume);
        // forge-lint: disable-next-line(unsafe-typecast)
        results[round] = RoundResult({settled: true, price: uint128(volume > 0 ? price : 0), volume: vol128});
        emit RoundSettled(round, volume > 0 ? price : 0, volume, n);
    }

    struct Totals {
        uint256 quoteIn; // paid by buyers
        uint256 quoteOut; // received by sellers
        uint256 slashed;
    }

    /// @dev Credit one order's outcome: slash an unrevealed bond, or pay fills and release the rest of the lock.
    function _applyOrder(uint256 round, uint256 i, Order memory o, uint256 f, uint256 price, Totals memory t)
        internal
    {
        if (o.status == Status.Committed) {
            t.slashed += bond;
            emit BondSlashed(round, i, o.trader, bond);
            return;
        }
        if (o.status != Status.Revealed) return;
        address quote = address(quoteToken);
        address base = address(baseToken);
        if (o.isBuy) {
            uint256 locked = _buyLock(o.amount, o.price);
            uint256 pay = f == 0 ? 0 : Math.mulDiv(f, price, PRICE_SCALE, Math.Rounding.Ceil);
            t.quoteIn += pay;
            balanceOf[o.trader][quote] += locked - pay;
            if (f > 0) {
                balanceOf[o.trader][base] += f;
                emit Filled(round, i, o.trader, true, f, pay);
            }
        } else {
            uint256 recv = f == 0 ? 0 : Math.mulDiv(f, price, PRICE_SCALE);
            t.quoteOut += recv;
            balanceOf[o.trader][base] += o.amount - f;
            if (f > 0) {
                balanceOf[o.trader][quote] += recv;
                emit Filled(round, i, o.trader, false, f, recv);
            }
        }
    }

    /// @dev Pick the price maximising matched volume; ties broken by smallest imbalance, then by
    ///      the midpoint of the tied range when that midpoint is equally good.
    function _clearingPrice(Order[] memory os)
        internal
        pure
        returns (uint256 price, uint256 demand, uint256 supply)
    {
        uint256 bestVol;
        uint256 bestImb = type(uint256).max;
        uint256 lo;
        uint256 hi;
        uint256 n = os.length;
        for (uint256 i; i < n; ++i) {
            if (os[i].status != Status.Revealed) continue;
            uint256 p = os[i].price;
            (uint256 d, uint256 s) = _curves(os, p);
            uint256 v = Math.min(d, s);
            if (v == 0) continue;
            uint256 imb = d > s ? d - s : s - d;
            if (v > bestVol || (v == bestVol && imb < bestImb)) {
                bestVol = v;
                bestImb = imb;
                lo = p;
                hi = p;
            } else if (v == bestVol && imb == bestImb) {
                if (p < lo) lo = p;
                if (p > hi) hi = p;
            }
        }
        if (bestVol == 0) return (0, 0, 0);

        price = lo;
        if (hi != lo) {
            uint256 mid = lo + (hi - lo) / 2;
            (uint256 d, uint256 s) = _curves(os, mid);
            uint256 v = Math.min(d, s);
            uint256 imb = d > s ? d - s : s - d;
            if (v == bestVol && imb == bestImb) price = mid;
        }
        (demand, supply) = _curves(os, price);
    }

    /// @dev demand = base wanted by buyers with limit >= p; supply = base offered by sellers with limit <= p.
    function _curves(Order[] memory os, uint256 p) internal pure returns (uint256 demand, uint256 supply) {
        uint256 n = os.length;
        for (uint256 i; i < n; ++i) {
            Order memory o = os[i];
            if (o.status != Status.Revealed) continue;
            if (o.isBuy) {
                if (o.price >= p) demand += o.amount;
            } else if (o.price <= p) {
                supply += o.amount;
            }
        }
    }

    /// @dev The short side fills completely. The long side fills pro-rata, rounded down, and the
    ///      rounding remainder is handed out in order so both sides trade exactly `volume`.
    function _allocate(
        Order[] memory os,
        uint256[] memory fills,
        uint256 price,
        uint256 volume,
        uint256 demand,
        uint256 supply
    ) internal pure {
        uint256 n = os.length;
        uint256 longTotal = Math.max(demand, supply);
        bool buysLong = demand > supply;
        bool sellsLong = supply > demand;
        uint256 longFilled;
        for (uint256 i; i < n; ++i) {
            Order memory o = os[i];
            if (o.status != Status.Revealed) continue;
            bool eligible = o.isBuy ? o.price >= price : o.price <= price;
            if (!eligible) continue;
            bool isLong = o.isBuy ? buysLong : sellsLong;
            if (isLong) {
                uint256 f = Math.mulDiv(o.amount, volume, longTotal);
                fills[i] = f;
                longFilled += f;
            } else {
                fills[i] = o.amount;
            }
        }
        if (!buysLong && !sellsLong) return;
        uint256 rem = volume - longFilled;
        for (uint256 i; i < n && rem > 0; ++i) {
            Order memory o = os[i];
            if (o.status != Status.Revealed) continue;
            if (o.isBuy != buysLong) continue;
            bool eligible = o.isBuy ? o.price >= price : o.price <= price;
            if (!eligible) continue;
            uint256 room = o.amount - fills[i];
            uint256 add = room < rem ? room : rem;
            fills[i] += add;
            rem -= add;
        }
    }

    // ================================================================== views

    function orderCount(uint256 round) external view returns (uint256) {
        return _orders[round].length;
    }

    function getOrder(uint256 round, uint256 index) external view returns (Order memory) {
        return _orders[round][index];
    }

    function getOrders(uint256 round) external view returns (Order[] memory) {
        return _orders[round];
    }

    /// @notice Everything the UI needs for the clock in one call.
    function clock()
        external
        view
        returns (uint256 round, Phase currentPhase, uint256 start, uint256 revealAt, uint256 end, uint256 orders)
    {
        round = currentRound();
        currentPhase = phase(round);
        start = roundStart(round);
        revealAt = revealStart(round);
        end = roundEnd(round);
        orders = _orders[round].length;
    }
}
