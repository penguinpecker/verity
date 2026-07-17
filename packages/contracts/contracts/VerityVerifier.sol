// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./lib/Claims.sol";

/// @title VerityVerifier
/// @notice On-chain verifier for Verity zkTLS proofs on the Horizen (ZEN) L3.
/// A proof is valid iff its claim is signed by at least `threshold` distinct
/// trusted Verity attestors, and the claim's identifier binds the exact
/// provider/parameters/context that were proven.
contract VerityVerifier {
	struct Proof {
		Claims.ClaimInfo claimInfo;
		Claims.SignedClaim signedClaim;
	}

	address public owner;
	/// trusted Verity attestor signing addresses
	mapping(address => bool) public isAttestor;
	uint256 public attestorCount;
	/// minimum number of distinct trusted attestor signatures required
	uint8 public threshold;

	event AttestorSet(address indexed attestor, bool trusted);
	event ThresholdSet(uint8 threshold);
	event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

	modifier onlyOwner() {
		require(msg.sender == owner, "VerityVerifier: not owner");
		_;
	}

	constructor(address[] memory attestors) {
		owner = msg.sender;
		emit OwnershipTransferred(address(0), msg.sender);
		for (uint256 i = 0; i < attestors.length; i++) {
			if (attestors[i] != address(0) && !isAttestor[attestors[i]]) {
				isAttestor[attestors[i]] = true;
				attestorCount++;
				emit AttestorSet(attestors[i], true);
			}
		}
		threshold = 1;
		emit ThresholdSet(1);
	}

	// --- admin ---

	function setAttestor(address attestor, bool trusted) external onlyOwner {
		require(attestor != address(0), "VerityVerifier: zero address");
		if (trusted && !isAttestor[attestor]) {
			isAttestor[attestor] = true;
			attestorCount++;
		} else if (!trusted && isAttestor[attestor]) {
			isAttestor[attestor] = false;
			attestorCount--;
		}
		emit AttestorSet(attestor, trusted);
	}

	function setThreshold(uint8 t) external onlyOwner {
		require(t > 0, "VerityVerifier: threshold must be > 0");
		threshold = t;
		emit ThresholdSet(t);
	}

	function transferOwnership(address newOwner) external onlyOwner {
		require(newOwner != address(0), "VerityVerifier: zero address");
		emit OwnershipTransferred(owner, newOwner);
		owner = newOwner;
	}

	// --- verification ---

	/// @notice Verify a proof. Reverts with a reason if invalid; returns true if valid.
	/// Integrators typically call this inside a require, or via a try/catch.
	function verifyProof(Proof memory proof) public view returns (bool) {
		// 1) Bind the revealed claimInfo to the signed identifier.
		bytes32 expected = Claims.hashClaimInfo(proof.claimInfo);
		require(
			proof.signedClaim.claim.identifier == expected,
			"VerityVerifier: identifier mismatch"
		);

		// 2) Recover the signer of every signature.
		require(proof.signedClaim.signatures.length > 0, "VerityVerifier: no signatures");
		address[] memory signers = Claims.recoverSignersOfSignedClaim(proof.signedClaim);

		// 3) Count distinct trusted attestors.
		uint256 distinctTrusted = 0;
		for (uint256 i = 0; i < signers.length; i++) {
			require(isAttestor[signers[i]], "VerityVerifier: untrusted attestor");
			bool seen = false;
			for (uint256 j = 0; j < i; j++) {
				if (signers[j] == signers[i]) {
					seen = true;
					break;
				}
			}
			if (!seen) distinctTrusted++;
		}
		require(distinctTrusted >= threshold, "VerityVerifier: not enough attestors");
		return true;
	}

	/// @notice Non-reverting variant — returns false instead of reverting.
	function isValidProof(Proof memory proof) external view returns (bool) {
		if (proof.signedClaim.signatures.length == 0) return false;
		if (proof.signedClaim.claim.identifier != Claims.hashClaimInfo(proof.claimInfo)) return false;
		address[] memory signers = Claims.recoverSignersOfSignedClaim(proof.signedClaim);
		uint256 distinctTrusted = 0;
		for (uint256 i = 0; i < signers.length; i++) {
			if (!isAttestor[signers[i]]) return false;
			bool seen = false;
			for (uint256 j = 0; j < i; j++) {
				if (signers[j] == signers[i]) { seen = true; break; }
			}
			if (!seen) distinctTrusted++;
		}
		return distinctTrusted >= threshold;
	}
}
