/**
 * ============================================================================
 * Decision Tree Engine — runs the ML-derived tree at request time
 * ============================================================================
 *
 * Loads `ml/exported_tree_tier{1,2}.json` (produced by ml/train_compare.py)
 * and traverses the tree to produce a probability distribution over service
 * types. This is the production replacement for the hand-tuned multiplicative
 * weight tables in triage-engine.ts.
 *
 * Two trees are loaded:
 *   - Tier 1 (QUESTIONNAIRE_ONLY)  → used when OBD data is unavailable
 *   - Tier 2 (OBD_ENHANCED)        → used when OBD data is attached
 *
 * Tree JSON shape (from ml/train_compare.py):
 *
 *   {
 *     "model_type":    "DecisionTreeClassifier",
 *     "class_names":   ["ALTERNATOR_ISSUE", "BATTERY_JUMP", ...],   // 19 entries
 *     "feature_names": ["Q1_intent=BRAKE_ISSUE", ...,
 *                       "battery_voltage_v", ...],
 *     "max_depth":     6,
 *     "n_leaves":      28,
 *     "root": <Node>
 *   }
 *
 *   Node = SplitNode | LeafNode
 *   SplitNode = { type: "split", feature, threshold, samples, left, right }
 *   LeafNode  = { type: "leaf",  samples, probabilities: { ServiceType: prob } }
 *
 * Feature name conventions:
 *   - Categorical one-hot:  "<colName>=<VALUE>"     → 1.0 if request matches, else 0.0
 *   - Numeric (OBD):        "<rawColName>"          → pass-through float value
 *
 * @author Janukshan Sivakumar - IT22635266
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────
// Types — describe the JSON tree shape
// ─────────────────────────────────────────────────────────────────────────

export interface LeafNode {
  type: 'leaf';
  samples: number;
  probabilities: Record<string, number>;
}

export interface SplitNode {
  type: 'split';
  feature: string;
  threshold: number;
  samples: number;
  left: TreeNode;
  right: TreeNode;
}

export type TreeNode = LeafNode | SplitNode;

export interface DecisionTreeJSON {
  model_type: string;
  class_names: string[];
  feature_names: string[];
  max_depth: number;
  n_leaves: number;
  root: TreeNode;
}

/**
 * Input to the tree engine. Categorical fields are strings; OBD-numeric
 * fields are numbers. Skipped questionnaire fields should be set to
 * the literal "NOT_ASKED" so they match the trained encoding.
 */
export type TreeInput = Record<string, string | number | string[] | undefined>;

export interface TreeResult {
  probabilities: Record<string, number>;  // sums to 1.0
  predictedClass: string;
  confidence: number;                      // 1 - normalized entropy
  entropy: number;
  samplesAtLeaf: number;
  pathDepth: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Tree caching — load once at startup, reuse for every request
// ─────────────────────────────────────────────────────────────────────────

const treeCache = new Map<string, DecisionTreeJSON>();

/** Resolve the absolute path to one of the exported trees. */
function treePathFor(tier: 1 | 2): string {
  // ml/ sits at <dispatch>/ml/, src/ at <dispatch>/src/, so go up one.
  return path.resolve(__dirname, '..', '..', 'ml', `exported_tree_tier${tier}.json`);
}

export function loadTree(tier: 1 | 2): DecisionTreeJSON {
  const cacheKey = `tier${tier}`;
  const cached = treeCache.get(cacheKey);
  if (cached) return cached;

  const filePath = treePathFor(tier);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Decision tree not found: ${filePath}\n` +
      `Run \`python ml/train_compare.py --tier ${tier}\` to generate it.`
    );
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const tree = JSON.parse(raw) as DecisionTreeJSON;

  if (tree.model_type !== 'DecisionTreeClassifier') {
    throw new Error(
      `Unexpected model_type "${tree.model_type}" in ${filePath}. ` +
      `Expected DecisionTreeClassifier.`
    );
  }

  logger.info('Loaded decision tree', {
    tier,
    classes:    tree.class_names.length,
    features:   tree.feature_names.length,
    depth:      tree.max_depth,
    leaves:     tree.n_leaves,
  });

  treeCache.set(cacheKey, tree);
  return tree;
}

/** For tests / hot-reload — drop the cached trees. */
export function _clearTreeCache(): void {
  treeCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────
// Feature-vector construction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the feature vector that matches the order in tree.feature_names.
 *
 * Each feature_name is one of:
 *   - "<colName>=<VALUE>"  → 1.0 if input[colName] equals VALUE
 *                            (or, for multi-select arrays, contains VALUE);
 *                            0.0 otherwise.
 *   - "<rawColName>"       → input[rawColName] as a number (NaN if absent).
 *
 * Skipped questionnaire questions should be passed as the string "NOT_ASKED"
 * so they match the trained encoding ("Q3_sound=NOT_ASKED" etc.).
 */
export function buildFeatureVector(
  input: TreeInput,
  featureNames: string[],
): number[] {
  const vec = new Array<number>(featureNames.length);

  for (let i = 0; i < featureNames.length; i++) {
    const name = featureNames[i];
    const eqIdx = name.indexOf('=');

    if (eqIdx === -1) {
      // Numeric (raw) feature — e.g. "battery_voltage_v"
      const v = input[name];
      vec[i] = typeof v === 'number' ? v : NaN;
    } else {
      // Categorical one-hot — e.g. "Q1_intent=WONT_START" or
      // "Q5_lights=BATTERY" (multi-select)
      const colName = name.substring(0, eqIdx);
      const expected = name.substring(eqIdx + 1);
      const actual = input[colName];

      if (Array.isArray(actual)) {
        vec[i] = actual.includes(expected) ? 1.0 : 0.0;
      } else if (typeof actual === 'string') {
        vec[i] = actual === expected ? 1.0 : 0.0;
      } else {
        // Missing / undefined → encoded as not-this-value
        vec[i] = 0.0;
      }
    }
  }

  return vec;
}

// ─────────────────────────────────────────────────────────────────────────
// Tree traversal
// ─────────────────────────────────────────────────────────────────────────

interface TraversalResult {
  leaf: LeafNode;
  depth: number;
}

/** Walk the tree until we hit a leaf; return the leaf + path depth. */
function traverse(
  node: TreeNode,
  features: number[],
  featureIndex: Map<string, number>,
  depth = 0,
): TraversalResult {
  if (node.type === 'leaf') {
    return { leaf: node, depth };
  }

  const idx = featureIndex.get(node.feature);
  if (idx === undefined) {
    throw new Error(
      `Tree references unknown feature "${node.feature}". ` +
      `This indicates the loaded tree was trained with a different schema.`
    );
  }

  const value = features[idx];
  // sklearn convention: go LEFT if value <= threshold, else RIGHT.
  // For one-hot (0/1) features with threshold ~0.5 this means:
  //   value 0 → left (feature absent), value 1 → right (feature present).
  const goRight = !Number.isNaN(value) && value > node.threshold;
  const next = goRight ? node.right : node.left;
  return traverse(next, features, featureIndex, depth + 1);
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

function shannonEntropy(probs: Record<string, number>): number {
  let h = 0;
  for (const p of Object.values(probs)) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Run a request through the trained decision tree.
 *
 * @param input Request features (questionnaire answers + optional OBD signals).
 *              See TreeInput for the expected shape. Skipped questionnaire
 *              answers MUST be passed as the string "NOT_ASKED".
 * @param tier  Which tree to use (1 = questionnaire-only, 2 = OBD-enhanced).
 * @returns     Probability distribution + predicted class + confidence.
 */
export function runDecisionTree(input: TreeInput, tier: 1 | 2): TreeResult {
  const tree = loadTree(tier);
  const features = buildFeatureVector(input, tree.feature_names);

  const featureIndex = new Map<string, number>();
  for (let i = 0; i < tree.feature_names.length; i++) {
    featureIndex.set(tree.feature_names[i], i);
  }

  const { leaf, depth } = traverse(tree.root, features, featureIndex);

  // Defensive: ensure the leaf's probability map covers every class.
  const probs: Record<string, number> = {};
  for (const cls of tree.class_names) {
    probs[cls] = leaf.probabilities[cls] ?? 0;
  }

  // Renormalise (the leaf should already sum to 1, but float error happens).
  const total = Object.values(probs).reduce((s, p) => s + p, 0);
  if (total > 0) {
    for (const cls of tree.class_names) probs[cls] /= total;
  }

  // Pick the argmax.
  let predictedClass = tree.class_names[0];
  let maxProb = probs[predictedClass] ?? 0;
  for (const cls of tree.class_names) {
    if (probs[cls] > maxProb) {
      maxProb = probs[cls];
      predictedClass = cls;
    }
  }

  const entropy = shannonEntropy(probs);
  const maxEntropy = Math.log2(tree.class_names.length);
  const confidence = Math.max(0, 1 - entropy / maxEntropy);

  return {
    probabilities: probs,
    predictedClass,
    confidence,
    entropy,
    samplesAtLeaf: leaf.samples,
    pathDepth:     depth,
  };
}
