import type { ExtractionResult } from '../types/extraction';

export function shouldWriteMarkdown(result: ExtractionResult): boolean {
  return result.privacy_level !== 'private';
}
