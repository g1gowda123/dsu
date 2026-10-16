import fs from 'fs';
import path from 'path';

/**
 * Locate artifact files in either root/artifacts or dashboard-web/artifacts
 */
export function getArtifactPath(filename: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), '..', 'artifacts', filename),
    path.resolve(process.cwd(), 'artifacts', filename),
    path.join(process.cwd(), '..', '..', 'artifacts', filename),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
        return candidate;
      }
    } catch {
      // Continue searching
    }
  }

  // Fallback default target path in parent artifacts dir
  return path.resolve(process.cwd(), '..', 'artifacts', filename);
}
