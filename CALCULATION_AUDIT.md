# Calculation Audit

## Removed from approval paths

- Simply-supported straight-beam modes, `sin(nπx/L)`, `m'L/2`, route-unfolding, and theoretical antinodes.
- Predicted frequency shift as evidence of vibration reduction.
- Hard-coded 5/10/15% resonance bands, 30 mm clearance, temperature allowables, and stock mass values as universal safety rules.
- Automatic larger-mass selection, rounded-mass approval, and approval based on pressure/static displays.

## Current calculations

- Canonical geometry accumulates real XYZ vectors and route distance; every point resolves against a segment.
- `reduction = (1 - V_after/V_support) × 100`; signed negative values are preserved.
- `V_target = min(0.5 × V_support, V_absolute_limit)`; both independent constraints must pass for every specified point/axis.
- Compatibility checks match identity fields and enforce configured operating tolerances before comparison.
- `f_1X = RPM/60` is retained only as screening context; measured dominant frequency is retained separately and no mode is silently substituted.

## Known non-calculations by design

No numerical maximum safe mass, damping ratio, fatigue allowance, clamp slip limit, or FEA/FRF result is invented when validated inputs/evidence are absent.
