# Engineering Basis

## Safety position

The product is a **mass-loaded vibration-control ring (mass detuner)** unless a specific recipe includes qualified rubber dynamic stiffness and loss data. It is not a tuned mass damper and is never represented as adding damping by default.

Final approval is fail-closed. A PASS requires an exact approved empirical recipe and comparable measured support-baseline and post-installation readings at every required braze and axis. The applicable acceptance tests are `V_after <= 0.50 V_support` and `V_after <= V_absolute_limit`. The initial company-project default is 6 mm/s, explicitly awaiting authorized engineering approval.

## Qualification hierarchy

1. Level A: exact empirical recipe, including qualified operating envelope and actual post-installation evidence. Only Level A can create a Worker Mode recipe.
2. Level B: validated complex-FRF/receptance or correlated 3D FEA. It may be shown to an engineer as a candidate; physical verification is required.
3. Level C: route length, pipe dimensions, frequency estimates, or idealized beam data alone. It is SCREENING ONLY and cannot determine a mass or location.

## Engineering controls

Location-specific maximum mass is only numeric when all applicable validated methods exist: tube, braze, clamp slip, retention, contact, fatigue, resonance and physically qualified maximum. The allowed value is their minimum; missing input means no safe-mass approval. Stock weights are inventory values, never limits. A zero-mass recipe is valid and preferred when qualified.

Complex receptance modification requires phase/real-imaginary data, DOF alignment, calibration, and acceptable coherence. Magnitude-only data is rejected. The code uses the scalar point-receptance form `Hnew = H / (1 - ω²mH)` only after those gates; full matrix work belongs in reviewed validated engineering tooling.

## Configuration governance

Every recipe must identify model, circuit, geometry revision, compressor/operating envelope, refrigerant, tube grade/temper, pressures and temperatures, 3D geometry, clamp/ring specification, evidence, approval, revision and source references. Thresholds without a source are company-configurable criteria, not material or code allowables.
