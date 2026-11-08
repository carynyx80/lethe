// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LetheAuction} from "../src/LetheAuction.sol";
import {TestToken} from "../src/TestToken.sol";

/// @notice Deploys valueless test tokens + LetheAuction to a local chain or Elysium testnet.
///
///   Dry run (simulates only, sends nothing):
///     EXPECTED_CHAIN_ID=99801 forge script script/Deploy.s.sol --rpc-url elysium_testnet
///   Broadcast (only with explicit approval):
///     ... --broadcast --keystore $DEPLOYER_KEYSTORE_PATH
///
/// Fails closed if the RPC's chain ID differs from EXPECTED_CHAIN_ID, and refuses mainnet outright:
/// mainnet needs real assets and a separate, reviewed release.
contract Deploy is Script {
    uint256 constant LOCAL = 31337;
    uint256 constant ELYSIUM_TESTNET = 99801;
    uint256 constant ELYSIUM_MAINNET = 99901;

    function run() external {
        uint256 expected = vm.envUint("EXPECTED_CHAIN_ID");
        require(block.chainid == expected, "chain id mismatch: RPC is not the network you expect");
        require(block.chainid != ELYSIUM_MAINNET, "mainnet deployment is disabled in this script");
        require(block.chainid == LOCAL || block.chainid == ELYSIUM_TESTNET, "unknown network");

        uint256 commitSecs = vm.envOr("COMMIT_SECONDS", uint256(20));
        uint256 revealSecs = vm.envOr("REVEAL_SECONDS", uint256(10));

        vm.startBroadcast();
        address deployer = msg.sender;
        address treasury = vm.envOr("TREASURY", deployer);

        TestToken base = new TestToken("Lethe Test HYPE", "tHYPE", 18, 100 ether);
        TestToken quote = new TestToken("Lethe Test USDC", "tUSDC", 6, 5_000e6);
        // Align genesis to the next whole minute so round boundaries are easy to read.
        uint256 genesis = (block.timestamp / 60 + 1) * 60;
        LetheAuction auction = new LetheAuction(
            IERC20(address(base)),
            IERC20(address(quote)),
            treasury,
            genesis,
            commitSecs,
            revealSecs,
            1e6, // bond: 1 tUSDC
            1e15, // min order: 0.001 tHYPE
            100 // max orders per round
        );
        vm.stopBroadcast();

        console2.log("chainId     ", block.chainid);
        console2.log("baseToken   ", address(base));
        console2.log("quoteToken  ", address(quote));
        console2.log("auction     ", address(auction));
        console2.log("genesis     ", genesis);
        console2.log("block       ", block.number);

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", block.number);
        vm.serializeUint(k, "genesis", genesis);
        vm.serializeUint(k, "commitSeconds", commitSecs);
        vm.serializeUint(k, "revealSeconds", revealSecs);
        vm.serializeAddress(k, "treasury", treasury);
        vm.serializeAddress(k, "baseToken", address(base));
        vm.serializeAddress(k, "quoteToken", address(quote));
        string memory json = vm.serializeAddress(k, "auction", address(auction));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }
}
