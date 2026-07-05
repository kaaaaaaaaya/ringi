/**
 * The Claude model Ringi judges and extracts with, in one neutral place.
 *
 * Kept out of judge.ts on purpose: the ingest CLI (src/ingest) shares this
 * constant but must not import judge.ts's runtime surface (the Anthropic
 * client wiring). A bare constant module has no side effects to inherit, so
 * the judge and the extractor stay pinned to the same model — and a model
 * bump is a one-line change in one file, not two that can silently diverge.
 */
export const JUDGE_MODEL = "claude-sonnet-4-5";
