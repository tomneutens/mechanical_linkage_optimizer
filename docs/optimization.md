# Linkage Generator — Optimization Process Documentation

## Overview

The Linkage Generator uses a **Differential Evolution (DE)** algorithm to search for
mechanical linkage parameters that produce an output curve matching a user-drawn target
curve. It supports three levels of linkage complexity (4-bar, 6-bar, 8-bar) and can
automatically escalate from simple to complex when needed.

---

## 1. Target Curve Sampling

Before optimization begins, the user-drawn Bézier curve is uniformly sampled into
**128 discrete points**. These points serve as the ground-truth target that the
optimizer tries to match.

---

## 2. Parameter Space

Each linkage type is defined by a set of continuous parameters. The optimizer searches
over these parameters:

### 4-Bar Linkage (10 parameters)
| Parameter           | Description                                         |
|---------------------|-----------------------------------------------------|
| `ground0x/y`        | Position of the first ground pivot (crank base)     |
| `ground1x/y`        | Position of the second ground pivot (rocker base)   |
| `crankLength`       | Length of the input crank arm                       |
| `couplerLength`     | Length of the coupler link                          |
| `followerLength`    | Length of the follower (rocker) link                |
| `couplerPointAngle` | Angular offset of the output point on the coupler   |
| `couplerPointDist`  | Distance of the output point from the coupler center|
| `phaseOffset`       | Starting phase angle of the crank                   |

### 6-Bar Linkage (16 parameters)
Extends the 4-bar with a second stage:
- A third ground pivot (`ground2x/y`)
- Second-stage link lengths (`crank2Length`, `coupler2Length`, `follower2Length`)
- Second crank phase offset

### 8-Bar Linkage (21 parameters)
Extends the 6-bar with a third dyad stage:
- A fourth ground pivot (`ground3x/y`)
- Third-stage link lengths (`link3aLength`, `link3bLength`, `link3cLength`)

### Parameter Bounds
All position parameters are bounded within a region derived from the **bounding box
of the target curve**, expanded by a margin. Link lengths are bounded between 5% and
120% of the target curve's overall size. This ensures the search space is relevant to
the target.

---

## 3. Differential Evolution Algorithm

DE is a population-based metaheuristic optimizer well-suited for continuous, non-linear
optimization problems where the fitness landscape may be noisy or have many local minima.

### Initialization
- **Population size**: `max(40, dimensions × 8)` — larger populations for higher
  dimensional problems (6/8-bar) to maintain diversity.
- Each individual is a vector of linkage parameters, initialized uniformly at random
  within the parameter bounds.

### Evolution Loop (per generation)
For each individual `i` in the population:

1. **Mutation**: Select three distinct random individuals `r1`, `r2`, `r3` (all ≠ `i`).
   Create a **donor vector**:
   ```
   donor[j] = population[r1][j] + F × (population[r2][j] − population[r3][j])
   ```
   where `F = 0.7` is the mutation scale factor.

2. **Crossover**: Create a **trial vector** by mixing the donor with the current
   individual. For each dimension `j`:
   - Use the donor value if `random() < CR` or `j == jRand` (at least one donor
     dimension is always used)
   - Otherwise keep the current value
   - `CR = 0.85` (crossover rate), `jRand` is a random dimension index

3. **Selection**: Evaluate the trial vector's fitness. If `fitness(trial) ≤ fitness(i)`,
   replace individual `i` with the trial vector (greedy selection).

4. **Best tracking**: If the trial's fitness is the best seen so far, store it as the
   current best solution.

### Hyperparameters
| Parameter       | Value | Purpose                                          |
|-----------------|-------|--------------------------------------------------|
| F (mutation)    | 0.7   | Controls exploration step size                   |
| CR (crossover)  | 0.85  | Balances exploration vs. exploitation             |
| Population size | 8×dim | Scales with problem dimensionality               |
| Batch yield     | 50    | Yield to UI thread every 50 generations          |

---

## 4. Fitness Function

The fitness (error) of a candidate linkage is computed as:

### Step 1: Forward Kinematics
The linkage is simulated through a **full 360° rotation** of the input crank(s),
computing the output point position at each step (same number of steps as target points).

If the linkage **jams** (cannot be assembled) at any angle — i.e., the circle-circle
intersection for the constraint solver has no real solution — the candidate is assigned
a **penalty fitness of 1×10⁹**.

### Step 2: Bidirectional Average Closest-Point Distance
The error between the traced output curve and the target curve is computed as:

```
error = (forward_distance + backward_distance) / (2 × N)
```

Where:
- **Forward distance**: For each target point, find the closest output trace point
  and sum the Euclidean distances.
- **Backward distance**: For each output trace point, find the closest target point
  and sum the Euclidean distances.

This bidirectional metric penalizes both:
- Output curves that miss parts of the target (forward)
- Output curves that overshoot or have extra loops (backward)

---

## 5. Linkage Assembly Solver (Forward Kinematics)

Each candidate linkage is solved using a **constraint-based iterative approach**:

1. **Set ground pivots** — fixed positions, always known.
2. **Set crank positions** — computed directly from the crank angle.
3. **Propagate constraints** — for each unsolved joint connected by a link to a solved
   joint, check if there's another link connecting it to a second solved joint. If so,
   compute the position using **circle-circle intersection**:
   - Two circles (centered at the two solved joints, with radii equal to the link
     lengths) intersect at 0, 1, or 2 points.
   - When two solutions exist, the one **closest to the joint's previous position**
     (hint) is selected, ensuring configuration continuity.
4. **Repeat** until all joints are resolved or no progress is made.

If any non-output joint remains unsolvable after 20 iterations, the configuration is
invalid (the linkage "jams").

---

## 6. Auto-Optimization Strategy

The **Auto Optimize** mode implements a progressive complexity strategy:

```
1. Try 4-bar linkage (50% of total iterations)
   → If error < threshold (15 px): DONE
   
2. Try 6-bar linkage (70% of total iterations)
   → If error < threshold (15 px): DONE
   
3. Try 8-bar linkage (100% of total iterations)
   → Return best result regardless of error
```

This approach:
- **Prefers simpler mechanisms**: A 4-bar linkage is always tried first.
- **Escalates only when needed**: Complexity only increases when the simpler mechanism
  can't achieve sufficient accuracy.
- **Allocates more computation to complex mechanisms**: Since higher-dimensional
  parameter spaces need more exploration.

The error threshold of **15 pixels** represents a good visual fit for the default
800×600 canvas. Users can manually select a specific complexity level to override
the auto strategy.

---

## 7. Linkage Topologies

### 4-Bar Linkage (Grashof)
The simplest closed-loop mechanism. Consists of:
- Ground frame (fixed link between two ground pivots)
- Input crank (rotates fully around ground pivot 0)
- Coupler (connects crank tip to rocker tip)
- Follower/rocker (oscillates around ground pivot 1)
- **Coupler point**: An output point attached rigidly to the coupler link, offset by
  an angle and distance from the coupler midpoint. This is where the output curve is
  traced.

### 6-Bar Watt I
Stacks a second 4-bar dyad on the output of the first:
- First stage: same as 4-bar
- Second stage: the first-stage follower drives a second coupler-rocker pair through
  a third ground pivot
- Optionally: two independent crank inputs for more complex motion

### 8-Bar Extension
Adds a third dyad stage, chaining three 4-bar mechanisms for highly complex curves.

---

## 8. Performance Notes

- The optimizer runs **in the main thread** with periodic `setTimeout(0)` yields to
  keep the UI responsive.
- Progress is reported every 50 generations so the progress bar updates smoothly.
- Typical run times:
  - 4-bar / 5000 iterations: a few seconds
  - 6-bar / 5000 iterations: 5–15 seconds
  - 8-bar / 5000 iterations: 15–45 seconds
- The bidirectional closest-point fitness is O(N²) per evaluation. For the default
  128 sample points, this is fast enough but scales quadratically.
