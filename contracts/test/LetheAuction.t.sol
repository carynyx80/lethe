// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LetheAuction} from "../src/LetheAuction.sol";
import {TestToken} from "../src/TestToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LetheAuctionTest is Test {
    LetheAuction auction;
    TestToken base; // tHYPE, 18 decimals
    TestToken quote; // tUSDC, 6 decimals

    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    address relayer = makeAddr("relayer");

    uint256 constant COMMIT = 20;
    uint256 constant REVEAL = 10;
    uint256 constant BOND = 1e6; // 1 tUSDC
    uint256 constant MIN = 1e15; // 0.001 tHYPE
    uint256 constant ONE = 1e18; // 1 tHYPE

    uint256 genesis;

    function setUp() public {
        vm.warp(1_000_000);
        base = new TestToken("Test HYPE", "tHYPE", 18, 1_000 ether);
        quote = new TestToken("Test USDC", "tUSDC", 6, 100_000e6);
        genesis = block.timestamp;
        auction = new LetheAuction(
            IERC20(address(base)), IERC20(address(quote)), treasury, genesis, COMMIT, REVEAL, BOND, MIN, 100
        );
        address[4] memory users = [alice, bob, carol, dave];
        for (uint256 i; i < users.length; ++i) {
            _fund(users[i], 100 ether, 10_000e6);
        }
    }

    // ------------------------------------------------------------------ helpers

    function _fund(address who, uint256 b, uint256 q) internal {
        deal(address(base), who, b);
        deal(address(quote), who, q);
        vm.startPrank(who);
        base.approve(address(auction), type(uint256).max);
        quote.approve(address(auction), type(uint256).max);
        if (b > 0) auction.deposit(address(base), b);
        if (q > 0) auction.deposit(address(quote), q);
        vm.stopPrank();
    }

    function _price(uint256 usdcPerHype) internal pure returns (uint256) {
        return usdcPerHype * 1e6; // quote base-units per 1e18 base base-units
    }

    struct Ord {
        address who;
        bool isBuy;
        uint256 price;
        uint256 amount;
        bytes32 salt;
        uint256 index;
    }

    function _commit(address who, bool isBuy, uint256 price, uint256 amount) internal returns (Ord memory o) {
        uint256 round = auction.currentRound();
        o = Ord(who, isBuy, price, amount, keccak256(abi.encode(who, price, amount, round, gasleft())), 0);
        bytes32 h = auction.commitmentHash(round, who, isBuy, price, amount, o.salt);
        vm.prank(who);
        o.index = auction.commit(round, h);
    }

    function _reveal(uint256 round, Ord memory o) internal {
        vm.prank(relayer); // anyone may reveal
        auction.reveal(round, o.index, o.isBuy, o.price, o.amount, o.salt);
    }

    function _toReveal(uint256 round) internal {
        vm.warp(auction.revealStart(round));
    }

    function _toEnd(uint256 round) internal {
        vm.warp(auction.roundEnd(round));
    }

    function _bal(address who, TestToken t) internal view returns (uint256) {
        return auction.balanceOf(who, address(t));
    }

    // ------------------------------------------------------------------ happy path

    function test_crossingOrdersClearAtMidpoint() public {
        uint256 r = auction.currentRound();
        Ord memory b = _commit(alice, true, _price(31), 10 * ONE);
        Ord memory s = _commit(bob, false, _price(29), 10 * ONE);
        _toReveal(r);
        _reveal(r, b);
        _reveal(r, s);
        _toEnd(r);
        auction.settle(r);

        (bool settled, uint128 price, uint128 volume) = auction.results(r);
        assertTrue(settled);
        assertEq(price, _price(30), "midpoint of tied range");
        assertEq(volume, 10 * ONE);

        // alice paid 300 USDC for 10 HYPE, refunded the 10 USDC she'd locked above clearing
        assertEq(_bal(alice, base), 110 ether);
        assertEq(_bal(alice, quote), 10_000e6 - 300e6);
        assertEq(_bal(bob, base), 90 ether);
        assertEq(_bal(bob, quote), 10_000e6 + 300e6);
        assertEq(_bal(treasury, quote), 0);
        _assertSolvent();
    }

    function test_proRataOnLongSide() public {
        uint256 r = auction.currentRound();
        Ord memory b1 = _commit(alice, true, _price(30), 6 * ONE);
        Ord memory b2 = _commit(carol, true, _price(30), 4 * ONE);
        Ord memory s = _commit(bob, false, _price(30), 5 * ONE);
        _toReveal(r);
        _reveal(r, b1);
        _reveal(r, b2);
        _reveal(r, s);
        _toEnd(r);
        auction.settle(r);

        assertEq(_bal(alice, base), 103 ether); // 6 * 5/10
        assertEq(_bal(carol, base), 102 ether); // 4 * 5/10
        assertEq(_bal(bob, base), 95 ether);
        assertEq(_bal(alice, quote), 10_000e6 - 90e6);
        assertEq(_bal(carol, quote), 10_000e6 - 60e6);
        assertEq(_bal(bob, quote), 10_000e6 + 150e6);
        _assertSolvent();
    }

    function test_roundingRemainderIsDistributedExactly() public {
        uint256 r = auction.currentRound();
        Ord memory b1 = _commit(alice, true, _price(30), ONE);
        Ord memory b2 = _commit(carol, true, _price(30), ONE);
        Ord memory b3 = _commit(dave, true, _price(30), ONE);
        Ord memory s = _commit(bob, false, _price(30), 2 * ONE);
        _toReveal(r);
        _reveal(r, b1);
        _reveal(r, b2);
        _reveal(r, b3);
        _reveal(r, s);
        _toEnd(r);
        auction.settle(r);

        uint256 got = (_bal(alice, base) - 100 ether) + (_bal(carol, base) - 100 ether) + (_bal(dave, base) - 100 ether);
        assertEq(got, 2 * ONE, "buyers receive exactly what sellers delivered");
        _assertSolvent();
    }

    function test_noCrossRefundsEveryone() public {
        uint256 r = auction.currentRound();
        Ord memory b = _commit(alice, true, _price(20), ONE);
        Ord memory s = _commit(bob, false, _price(30), ONE);
        _toReveal(r);
        _reveal(r, b);
        _reveal(r, s);
        _toEnd(r);
        auction.settle(r);

        (, uint128 price, uint128 volume) = auction.results(r);
        assertEq(price, 0);
        assertEq(volume, 0);
        assertEq(_bal(alice, quote), 10_000e6);
        assertEq(_bal(bob, base), 100 ether);
        _assertSolvent();
    }

    function test_resultsRange() public {
        uint256 r = auction.currentRound();
        Ord memory b = _commit(alice, true, _price(30), ONE);
        Ord memory s = _commit(bob, false, _price(30), ONE);
        _toReveal(r);
        _reveal(r, b);
        _reveal(r, s);
        _toEnd(r);
        auction.settle(r);
        LetheAuction.RoundResult[] memory rs = auction.resultsRange(r, 2);
        assertTrue(rs[0].settled);
        assertEq(rs[0].price, _price(30));
        assertFalse(rs[1].settled);
    }

    function test_delayedCommitForOldRoundReverts() public {
        uint256 r = auction.currentRound();
        _toEnd(r); // next round's commit phase
        vm.prank(alice);
        vm.expectRevert(LetheAuction.WrongRound.selector);
        auction.commit(r, bytes32(uint256(1)));
    }

    function test_emptyRoundSettles() public {
        uint256 r = auction.currentRound();
        _toEnd(r);
        auction.settle(r);
        (bool settled,,) = auction.results(r);
        assertTrue(settled);
    }

    function test_maximisesVolume() public {
        // buys: 5 @ 32, 5 @ 30; sells: 4 @ 29, 6 @ 31
        // @30 -> D=10,S=4 (V=4) ; @31 -> D=5,S=10 (V=5) ; @32 -> D=5,S=10 (V=5) ; @29 -> D=10,S=4
        // V=5 at 31 and 32 with equal imbalance; midpoint 31.5 also gives V=5 -> price 31.5
        uint256 r = auction.currentRound();
        Ord memory a = _commit(alice, true, _price(32), 5 * ONE);
        Ord memory c = _commit(carol, true, _price(30), 5 * ONE);
        Ord memory b = _commit(bob, false, _price(29), 4 * ONE);
        Ord memory d = _commit(dave, false, _price(31), 6 * ONE);
        _toReveal(r);
        _reveal(r, a);
        _reveal(r, c);
        _reveal(r, b);
        _reveal(r, d);
        _toEnd(r);
        auction.settle(r);
        (, uint128 price, uint128 volume) = auction.results(r);
        assertEq(volume, 5 * ONE);
        assertEq(price, 31_500_000);
        assertEq(_bal(carol, base), 100 ether, "buyer below clearing gets nothing");
        assertEq(_bal(carol, quote), 10_000e6, "and is fully refunded");
        assertEq(_bal(alice, base), 105 ether);
        _assertSolvent();
    }

    // ------------------------------------------------------------------ bonds

    function test_unrevealedBondIsSlashed() public {
        uint256 r = auction.currentRound();
        _commit(alice, true, _price(30), ONE);
        assertEq(_bal(alice, quote), 10_000e6 - BOND);
        _toEnd(r);
        auction.settle(r);
        assertEq(_bal(alice, quote), 10_000e6 - BOND);
        assertEq(_bal(treasury, quote), BOND);
        _assertSolvent();
    }

    function test_revealReturnsBond() public {
        uint256 r = auction.currentRound();
        Ord memory o = _commit(alice, false, _price(30), ONE);
        _toReveal(r);
        _reveal(r, o);
        assertEq(_bal(alice, quote), 10_000e6);
        assertEq(_bal(alice, base), 99 ether, "sell amount locked");
    }

    function test_cancelInCommitPhase() public {
        uint256 r = auction.currentRound();
        Ord memory o = _commit(alice, true, _price(30), ONE);
        vm.prank(alice);
        auction.cancel(r, o.index);
        assertEq(_bal(alice, quote), 10_000e6);
        _toReveal(r);
        vm.expectRevert(LetheAuction.BadStatus.selector);
        _reveal(r, o);
    }

    function test_cancelOnlyByTraderAndOnlyInCommit() public {
        uint256 r = auction.currentRound();
        Ord memory o = _commit(alice, true, _price(30), ONE);
        vm.prank(bob);
        vm.expectRevert(LetheAuction.NotTrader.selector);
        auction.cancel(r, o.index);
        _toReveal(r);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LetheAuction.WrongPhase.selector, LetheAuction.Phase.Reveal));
        auction.cancel(r, o.index);
    }

    // ------------------------------------------------------------------ validation

    function test_revealMismatchReverts() public {
        uint256 r = auction.currentRound();
        Ord memory o = _commit(alice, true, _price(30), ONE);
        _toReveal(r);
        vm.expectRevert(LetheAuction.CommitmentMismatch.selector);
        auction.reveal(r, o.index, true, _price(31), ONE, o.salt);
        vm.expectRevert(LetheAuction.CommitmentMismatch.selector);
        auction.reveal(r, o.index, false, _price(30), ONE, o.salt);
    }

    function test_commitmentCannotBeStolenByAnotherTrader() public {
        // bob copies alice's hash; it is bound to alice, so bob cannot reveal it as his own
        uint256 r = auction.currentRound();
        Ord memory o = _commit(alice, true, _price(30), ONE);
        bytes32 h = auction.getOrder(r, o.index).commitment;
        vm.prank(bob);
        uint256 bi = auction.commit(r, h);
        _toReveal(r);
        vm.expectRevert(LetheAuction.CommitmentMismatch.selector);
        auction.reveal(r, bi, true, _price(30), ONE, o.salt);
    }

    function test_revealWithoutFundsReverts() public {
        address eve = makeAddr("eve");
        _fund(eve, 0, BOND);
        uint256 r = auction.currentRound();
        Ord memory o = _commit(eve, true, _price(30), ONE);
        _toReveal(r);
        vm.expectRevert(LetheAuction.InsufficientBalance.selector);
        _reveal(r, o);
    }

    function test_tinyOrderRejected() public {
        uint256 r = auction.currentRound();
        Ord memory o = _commit(alice, true, _price(30), MIN - 1);
        _toReveal(r);
        vm.expectRevert(LetheAuction.InvalidOrder.selector);
        _reveal(r, o);
    }

    function test_phaseGuards() public {
        uint256 r = auction.currentRound();
        Ord memory o = _commit(alice, true, _price(30), ONE);
        // reveal during commit
        vm.expectRevert(abi.encodeWithSelector(LetheAuction.WrongPhase.selector, LetheAuction.Phase.Commit));
        _reveal(r, o);
        // settle during commit
        vm.expectRevert(abi.encodeWithSelector(LetheAuction.WrongPhase.selector, LetheAuction.Phase.Commit));
        auction.settle(r);
        _toReveal(r);
        // commit during reveal
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LetheAuction.WrongPhase.selector, LetheAuction.Phase.Reveal));
        auction.commit(r, bytes32(uint256(1)));
        _toEnd(r);
        // reveal after end
        vm.expectRevert(abi.encodeWithSelector(LetheAuction.WrongPhase.selector, LetheAuction.Phase.Settleable));
        _reveal(r, o);
        auction.settle(r);
        vm.expectRevert(abi.encodeWithSelector(LetheAuction.WrongPhase.selector, LetheAuction.Phase.Settled));
        auction.settle(r);
    }

    function test_roundFull() public {
        LetheAuction small = new LetheAuction(
            IERC20(address(base)), IERC20(address(quote)), treasury, block.timestamp, COMMIT, REVEAL, BOND, MIN, 2
        );
        deal(address(quote), alice, 10e6);
        vm.startPrank(alice);
        quote.approve(address(small), type(uint256).max);
        small.deposit(address(quote), 10e6);
        small.commit(0, bytes32(uint256(1)));
        small.commit(0, bytes32(uint256(2)));
        vm.expectRevert(LetheAuction.RoundFull.selector);
        small.commit(0, bytes32(uint256(3)));
        vm.stopPrank();
    }

    function test_cannotWithdrawLockedFunds() public {
        uint256 r = auction.currentRound();
        Ord memory o = _commit(alice, false, _price(30), 100 ether);
        _toReveal(r);
        _reveal(r, o);
        vm.prank(alice);
        vm.expectRevert(LetheAuction.InsufficientBalance.selector);
        auction.withdraw(address(base), 1);
    }

    function test_unsupportedToken() public {
        TestToken other = new TestToken("X", "X", 18, 1);
        vm.expectRevert(LetheAuction.UnsupportedToken.selector);
        auction.deposit(address(other), 1);
    }

    function test_badConfigReverts() public {
        vm.expectRevert(LetheAuction.InvalidConfig.selector);
        new LetheAuction(IERC20(address(base)), IERC20(address(base)), treasury, 0, 1, 1, 0, 1, 10);
        vm.expectRevert(LetheAuction.InvalidConfig.selector);
        new LetheAuction(IERC20(address(base)), IERC20(address(quote)), treasury, 0, 1, 1, 0, 1, 201);
    }

    // ------------------------------------------------------------------ vault

    function test_withdraw() public {
        vm.prank(alice);
        auction.withdraw(address(quote), 1_000e6);
        assertEq(quote.balanceOf(alice), 1_000e6);
        assertEq(_bal(alice, quote), 9_000e6);
    }

    function test_depositWithPermit() public {
        (address owner, uint256 pk) = makeAddrAndKey("permit");
        deal(address(quote), owner, 50e6);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                quote.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                        owner,
                        address(auction),
                        50e6,
                        quote.nonces(owner),
                        deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(pk, digest);
        vm.prank(owner);
        auction.depositWithPermit(address(quote), 50e6, deadline, v, rr, ss);
        assertEq(_bal(owner, quote), 50e6);
    }

    function test_faucetCooldown() public {
        address f = makeAddr("faucet-user");
        vm.startPrank(f);
        quote.faucet();
        assertEq(quote.balanceOf(f), 100_000e6);
        vm.expectRevert();
        quote.faucet();
        vm.warp(block.timestamp + 1 hours);
        quote.faucet();
        vm.stopPrank();
        assertEq(quote.balanceOf(f), 200_000e6);
    }

    function test_roundsAreIndependent() public {
        uint256 r0 = auction.currentRound();
        Ord memory a = _commit(alice, true, _price(30), ONE);
        _toEnd(r0); // r0 not settled yet; r1 commit phase is open
        uint256 r1 = auction.currentRound();
        assertEq(r1, r0 + 1);
        Ord memory b = _commit(bob, false, _price(30), ONE);
        auction.settle(r0); // alice never revealed
        assertEq(_bal(treasury, quote), BOND);
        _toReveal(r1);
        _reveal(r1, b);
        _toEnd(r1);
        auction.settle(r1);
        assertEq(_bal(bob, base), 100 ether, "unmatched sell refunded");
        a; // silence
        _assertSolvent();
    }

    function test_fullRoundSettleGas() public {
        uint256 r = auction.currentRound();
        address[4] memory users = [alice, bob, carol, dave];
        Ord[] memory os = new Ord[](100);
        for (uint256 i; i < 100; ++i) {
            os[i] = _commit(users[i % 4], i % 2 == 0, _price(25) + i * 100_000, ONE / 10);
        }
        _toReveal(r);
        for (uint256 i; i < 100; ++i) {
            _reveal(r, os[i]);
        }
        _toEnd(r);
        uint256 g = gasleft();
        auction.settle(r);
        uint256 used = g - gasleft();
        emit log_named_uint("settle gas, 100 orders", used);
        assertLt(used, 15_000_000);
        _assertSolvent();
    }

    // ------------------------------------------------------------------ fuzz

    /// @dev Random order books: funds are conserved, nobody trades worse than their limit,
    ///      and both sides of the book move exactly the same base volume.
    function testFuzz_settlementConservesFunds(uint256 seed) public {
        uint256 r = auction.currentRound();
        address[4] memory users = [alice, bob, carol, dave];
        Ord[] memory os = new Ord[](12);
        for (uint256 i; i < os.length; ++i) {
            uint256 x = uint256(keccak256(abi.encode(seed, i)));
            address who = users[x % 4];
            bool isBuy = (x >> 8) % 2 == 0;
            uint256 price = _price(25) + ((x >> 16) % 10_000_000); // 25.0 .. 35.0 USDC
            uint256 amount = MIN + ((x >> 64) % (5 * ONE));
            os[i] = _commit(who, isBuy, price, amount);
        }
        _toReveal(r);
        uint256[4] memory baseBefore;
        uint256[4] memory quoteBefore;
        for (uint256 i; i < os.length; ++i) {
            // skip a few reveals to exercise slashing
            if (uint256(keccak256(abi.encode(seed, i, "skip"))) % 7 == 0) continue;
            _reveal(r, os[i]);
        }
        for (uint256 u; u < 4; ++u) {
            baseBefore[u] = _bal(users[u], base);
            quoteBefore[u] = _bal(users[u], quote);
        }
        _toEnd(r);
        auction.settle(r);
        _assertSolvent();

        (, uint128 price_, uint128 volume) = auction.results(r);
        uint256 bought;
        uint256 sold;
        for (uint256 i; i < os.length; ++i) {
            LetheAuction.Order memory o = auction.getOrder(r, os[i].index);
            if (o.status != LetheAuction.Status.Revealed || volume == 0) continue;
            if (o.isBuy && o.price >= price_) bought += 1;
            if (!o.isBuy && o.price <= price_) sold += 1;
        }
        if (volume > 0) {
            assertGt(bought, 0);
            assertGt(sold, 0);
        }
    }

    /// @dev With every round settled, the contract holds exactly the sum of all vault balances.
    function _assertSolvent() internal {
        address[6] memory who = [alice, bob, carol, dave, treasury, makeAddr("eve")];
        uint256 b;
        uint256 q;
        for (uint256 i; i < who.length; ++i) {
            b += _bal(who[i], base);
            q += _bal(who[i], quote);
        }
        assertEq(b, base.balanceOf(address(auction)), "base accounting");
        assertEq(q, quote.balanceOf(address(auction)), "quote accounting");
    }
}
