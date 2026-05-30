/** In-memory model preference — set from Settings, persisted to DB, read by openai.ts */
let _model: string = '';

export function getPreferredModel(fallback: string): string {
  return _model || fallback;
}

export function setPreferredModel(model: string): void {
  _model = model;
}
