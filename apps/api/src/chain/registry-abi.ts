// Generated from contracts/CreditRegistry.sol by `npm run abi -w contracts`. Do not edit by hand.
export const REGISTRY_ABI = [
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "_strictMode",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "BatchFrozen",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BatchRetired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BatchUnknown",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DuplicateBoundaryAndPeriod",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "originalProjectId",
        "type": "bytes32"
      }
    ],
    "name": "EvidenceReused",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ExceedsAttestedReduction",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MissingCorrespondingAdjustment",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotApproved",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotAuthorized",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotOwner",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ProjectExists",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ProjectUnknown",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "RunAlreadyAnchored",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "batchId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes2",
        "name": "hostCountry",
        "type": "bytes2"
      },
      {
        "indexed": false,
        "internalType": "bytes2",
        "name": "buyerCountry",
        "type": "bytes2"
      }
    ],
    "name": "AdjustmentRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "projectId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "enum CreditRegistry.AttestationStatus",
        "name": "status",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "attestedReduction",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "AttestationSubmitted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "batchId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "CreditsFrozen",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "batchId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "projectId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "quantity",
        "type": "uint256"
      }
    ],
    "name": "CreditsMinted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "batchId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "beneficiary",
        "type": "string"
      }
    ],
    "name": "CreditsRetired",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "batchId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes2",
        "name": "toCountry",
        "type": "bytes2"
      }
    ],
    "name": "CreditsTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "projectId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "developer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes2",
        "name": "hostCountry",
        "type": "bytes2"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "boundaryHash",
        "type": "bytes32"
      }
    ],
    "name": "ProjectRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "runId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "runHash",
        "type": "bytes32"
      }
    ],
    "name": "RunAnchored",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "admin",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "runId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "runHash",
        "type": "bytes32"
      }
    ],
    "name": "anchorRun",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "batches",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "projectId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "bytes2",
        "name": "ownerCountry",
        "type": "bytes2"
      },
      {
        "internalType": "uint256",
        "name": "quantity",
        "type": "uint256"
      },
      {
        "internalType": "enum CreditRegistry.BatchStatus",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "bool",
        "name": "adjusted",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "boundaryOwner",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "evidenceOwner",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "batchId",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "freezeCredits",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "isOperator",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "isVerifier",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "projectId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "quantity",
        "type": "uint256"
      }
    ],
    "name": "mintCredits",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "batchId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextBatchId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "projects",
    "outputs": [
      {
        "internalType": "address",
        "name": "developer",
        "type": "address"
      },
      {
        "internalType": "bytes2",
        "name": "hostCountry",
        "type": "bytes2"
      },
      {
        "internalType": "bytes32",
        "name": "boundaryHash",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "periodStart",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "periodEnd",
        "type": "uint64"
      },
      {
        "internalType": "enum CreditRegistry.AttestationStatus",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "attestedReduction",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minted",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "boundaryKey",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "exists",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "batchId",
        "type": "uint256"
      },
      {
        "internalType": "bytes2",
        "name": "buyerCountry",
        "type": "bytes2"
      }
    ],
    "name": "recordCorrespondingAdjustment",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "projectId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "developer",
        "type": "address"
      },
      {
        "internalType": "bytes2",
        "name": "hostCountry",
        "type": "bytes2"
      },
      {
        "internalType": "bytes32",
        "name": "boundaryHash",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "periodStart",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "periodEnd",
        "type": "uint64"
      }
    ],
    "name": "registerProject",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "batchId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "beneficiary",
        "type": "string"
      }
    ],
    "name": "retireCredits",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "runAnchors",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "allowed",
        "type": "bool"
      }
    ],
    "name": "setOperator",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "allowed",
        "type": "bool"
      }
    ],
    "name": "setVerifier",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "strictMode",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "projectId",
        "type": "bytes32"
      },
      {
        "internalType": "enum CreditRegistry.AttestationStatus",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "attestedReduction",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "submitAttestation",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "batchId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "actor",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "bytes2",
        "name": "toCountry",
        "type": "bytes2"
      }
    ],
    "name": "transferCredits",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
