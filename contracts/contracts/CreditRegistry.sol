// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Carbon Gauntlet CreditRegistry
/// @notice Enforces the carbon-credit lifecycle after AI verification:
///         Registered -> Attested -> Minted -> Transferred -> Retired (Frozen possible before Retired).
/// @dev    EXPERIMENTAL PROTOTYPE on synthetic data. Not a real registry.
///         Two instances are deployed: strictMode = false (Unprotected) and strictMode = true (Protected).
///         In Unprotected mode the integrity checks are skipped but every event is still logged,
///         so the same attacks can be compared against both.
///         Simulated agents do not hold their own wallets: the backend relays their actions as OPERATOR,
///         passing the agent's address as `actor`. The rules below are still enforced on-chain.
contract CreditRegistry {
    // ---------------------------------------------------------------- types
    enum AttestationStatus { None, Approved, ReviewRequired, Rejected }
    enum BatchStatus { None, Active, Frozen, Retired }

    struct Project {
        address developer;
        bytes2 hostCountry;          // ISO-3166 alpha-2, e.g. "TR"
        bytes32 boundaryHash;        // hash of the GeoJSON boundary
        uint64 periodStart;          // unix seconds
        uint64 periodEnd;
        AttestationStatus status;
        bytes32 evidenceHash;
        uint256 attestedReduction;   // tCO2e approved by the verifier
        uint256 minted;              // tCO2e minted so far
        bool exists;
    }

    struct Batch {
        bytes32 projectId;
        address owner;
        bytes2 ownerCountry;
        uint256 quantity;
        BatchStatus status;
        bool adjusted;               // corresponding adjustment recorded
    }

    // ---------------------------------------------------------------- state
    bool public immutable strictMode;
    address public admin;
    mapping(address => bool) public isVerifier;
    mapping(address => bool) public isOperator;

    mapping(bytes32 => Project) public projects;
    mapping(bytes32 => bool) public boundaryPeriodUsed;  // keccak(boundaryHash, start, end)
    mapping(bytes32 => bytes32) public evidenceOwner;    // evidenceHash => projectId
    mapping(uint256 => Batch) public batches;
    mapping(bytes32 => bytes32) public runAnchors;       // runId => runHash
    uint256 public nextBatchId = 1;

    // ---------------------------------------------------------------- events
    event ProjectRegistered(bytes32 indexed projectId, address indexed developer, bytes2 hostCountry, bytes32 boundaryHash);
    event AttestationSubmitted(bytes32 indexed projectId, AttestationStatus status, uint256 attestedReduction, bytes32 evidenceHash);
    event CreditsMinted(uint256 indexed batchId, bytes32 indexed projectId, address indexed owner, uint256 quantity);
    event CreditsTransferred(uint256 indexed batchId, address indexed from, address indexed to, bytes2 toCountry);
    event AdjustmentRecorded(uint256 indexed batchId, bytes2 hostCountry, bytes2 buyerCountry);
    event CreditsFrozen(uint256 indexed batchId, string reason);
    event CreditsRetired(uint256 indexed batchId, address indexed owner, string beneficiary);
    event RunAnchored(bytes32 indexed runId, bytes32 runHash);

    // ---------------------------------------------------------------- errors
    error NotAuthorized();
    error ProjectExists();
    error ProjectUnknown();
    error DuplicateBoundaryAndPeriod();
    error EvidenceReused(bytes32 originalProjectId);
    error NotApproved();
    error ExceedsAttestedReduction();
    error NotOwner();
    error BatchUnknown();
    error BatchFrozen();
    error BatchRetired();
    error MissingCorrespondingAdjustment();
    error RunAlreadyAnchored();

    // ---------------------------------------------------------------- modifiers
    modifier onlyAdmin() { if (msg.sender != admin) revert NotAuthorized(); _; }
    modifier onlyVerifier() { if (!isVerifier[msg.sender]) revert NotAuthorized(); _; }
    modifier onlyOperator() { if (!isOperator[msg.sender]) revert NotAuthorized(); _; }

    constructor(bool _strictMode) {
        strictMode = _strictMode;
        admin = msg.sender;
        isVerifier[msg.sender] = true;
        isOperator[msg.sender] = true;
    }

    function setVerifier(address account, bool allowed) external onlyAdmin { isVerifier[account] = allowed; }
    function setOperator(address account, bool allowed) external onlyAdmin { isOperator[account] = allowed; }

    // ---------------------------------------------------------------- lifecycle
    function registerProject(
        bytes32 projectId,
        address developer,
        bytes2 hostCountry,
        bytes32 boundaryHash,
        uint64 periodStart,
        uint64 periodEnd
    ) external onlyOperator {
        if (projects[projectId].exists) revert ProjectExists();

        bytes32 key = keccak256(abi.encodePacked(boundaryHash, periodStart, periodEnd));
        if (strictMode && boundaryPeriodUsed[key]) revert DuplicateBoundaryAndPeriod();
        boundaryPeriodUsed[key] = true;

        Project storage p = projects[projectId];
        p.developer = developer;
        p.hostCountry = hostCountry;
        p.boundaryHash = boundaryHash;
        p.periodStart = periodStart;
        p.periodEnd = periodEnd;
        p.exists = true;

        emit ProjectRegistered(projectId, developer, hostCountry, boundaryHash);
    }

    /// @notice Records the AI verifier's attestation. Partial overlaps are judged off-chain by the
    ///         verifier (polygon geometry); exact evidence reuse is also blocked here on-chain.
    function submitAttestation(
        bytes32 projectId,
        AttestationStatus status,
        uint256 attestedReduction,
        bytes32 evidenceHash
    ) external onlyVerifier {
        Project storage p = projects[projectId];
        if (!p.exists) revert ProjectUnknown();

        bytes32 original = evidenceOwner[evidenceHash];
        if (strictMode && original != bytes32(0) && original != projectId) revert EvidenceReused(original);
        if (original == bytes32(0)) evidenceOwner[evidenceHash] = projectId;

        p.status = status;
        p.evidenceHash = evidenceHash;
        p.attestedReduction = attestedReduction;

        emit AttestationSubmitted(projectId, status, attestedReduction, evidenceHash);
    }

    function mintCredits(bytes32 projectId, address actor, uint256 quantity) external onlyOperator returns (uint256 batchId) {
        Project storage p = projects[projectId];
        if (!p.exists) revert ProjectUnknown();
        if (actor != p.developer) revert NotOwner();
        if (strictMode) {
            if (p.status != AttestationStatus.Approved) revert NotApproved();
            if (p.minted + quantity > p.attestedReduction) revert ExceedsAttestedReduction();
        }
        p.minted += quantity;

        batchId = nextBatchId++;
        batches[batchId] = Batch(projectId, actor, p.hostCountry, quantity, BatchStatus.Active, false);
        emit CreditsMinted(batchId, projectId, actor, quantity);
    }

    /// @notice Simplified corresponding-adjustment ledger inspired by Paris Agreement Article 6.
    ///         Not a legal implementation: it only marks that the host country will not also count
    ///         this reduction, which unlocks cross-border transfer.
    function recordCorrespondingAdjustment(uint256 batchId, bytes2 buyerCountry) external onlyOperator {
        Batch storage b = batches[batchId];
        if (b.status == BatchStatus.None) revert BatchUnknown();
        b.adjusted = true;
        emit AdjustmentRecorded(batchId, projects[b.projectId].hostCountry, buyerCountry);
    }

    function transferCredits(uint256 batchId, address actor, address to, bytes2 toCountry) external onlyOperator {
        Batch storage b = batches[batchId];
        if (b.status == BatchStatus.None) revert BatchUnknown();
        if (actor != b.owner) revert NotOwner();
        if (strictMode) {
            if (b.status == BatchStatus.Frozen) revert BatchFrozen();
            if (b.status == BatchStatus.Retired) revert BatchRetired();
            if (toCountry != projects[b.projectId].hostCountry && !b.adjusted) revert MissingCorrespondingAdjustment();
        }
        b.owner = to;
        b.ownerCountry = toCountry;
        emit CreditsTransferred(batchId, actor, to, toCountry);
    }

    function freezeCredits(uint256 batchId, string calldata reason) external onlyVerifier {
        Batch storage b = batches[batchId];
        if (b.status == BatchStatus.None) revert BatchUnknown();
        if (b.status == BatchStatus.Retired) revert BatchRetired();
        b.status = BatchStatus.Frozen;
        emit CreditsFrozen(batchId, reason);
    }

    function retireCredits(uint256 batchId, address actor, string calldata beneficiary) external onlyOperator {
        Batch storage b = batches[batchId];
        if (b.status == BatchStatus.None) revert BatchUnknown();
        if (actor != b.owner) revert NotOwner();
        if (strictMode) {
            if (b.status == BatchStatus.Frozen) revert BatchFrozen();
            if (b.status == BatchStatus.Retired) revert BatchRetired();
        }
        b.status = BatchStatus.Retired;
        emit CreditsRetired(batchId, actor, beneficiary);
    }

    /// @notice Stores the hash of a full simulation run (seed + scenario + action log + model version)
    ///         so anyone can re-run it and check the published result was not edited.
    function anchorRun(bytes32 runId, bytes32 runHash) external onlyOperator {
        if (runAnchors[runId] != bytes32(0)) revert RunAlreadyAnchored();
        runAnchors[runId] = runHash;
        emit RunAnchored(runId, runHash);
    }
}
