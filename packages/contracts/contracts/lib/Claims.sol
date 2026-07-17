// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./StringUtils.sol";

/// Serialise & verify attestor-signed claims. The serialization here is byte-for-byte
/// identical to the attestor's (Reclaim-compatible), so a claim signed off-chain by an
/// attestor recovers to the same address on-chain.
library Claims {
	struct CompleteClaimData {
		bytes32 identifier;
		address owner;
		uint32 timestampS;
		uint32 epoch;
	}

	struct ClaimInfo {
		string provider;
		string parameters;
		string context;
	}

	struct SignedClaim {
		CompleteClaimData claim;
		bytes[] signatures;
	}

	/// Recover the address(es) that signed a claim.
	function recoverSignersOfSignedClaim(
		SignedClaim memory self
	) internal pure returns (address[] memory) {
		bytes memory serialised = serialise(self.claim);
		address[] memory signers = new address[](self.signatures.length);
		for (uint256 i = 0; i < self.signatures.length; i++) {
			signers[i] = verifySignature(serialised, self.signatures[i]);
		}
		return signers;
	}

	/// Serialise the claim into the exact string the attestor signs.
	function serialise(
		CompleteClaimData memory self
	) internal pure returns (bytes memory) {
		return
			abi.encodePacked(
				StringUtils.bytes2str(abi.encodePacked(self.identifier)),
				"\n",
				StringUtils.address2str(self.owner),
				"\n",
				StringUtils.uint2str(self.timestampS),
				"\n",
				StringUtils.uint2str(self.epoch)
			);
	}

	/// Recover the signer of an EIP-191 (personal_sign) signature over `content`.
	function verifySignature(
		bytes memory content,
		bytes memory signature
	) internal pure returns (address signer) {
		bytes32 signedHash = keccak256(
			abi.encodePacked(
				"\x19Ethereum Signed Message:\n",
				StringUtils.uint2str(content.length),
				content
			)
		);
		return ECDSA.recover(signedHash, signature);
	}

	/// The claim identifier = keccak256(provider "\n" parameters "\n" context).
	function hashClaimInfo(ClaimInfo memory claimInfo) internal pure returns (bytes32) {
		bytes memory serialised = abi.encodePacked(
			claimInfo.provider,
			"\n",
			claimInfo.parameters,
			"\n",
			claimInfo.context
		);
		return keccak256(serialised);
	}
}
