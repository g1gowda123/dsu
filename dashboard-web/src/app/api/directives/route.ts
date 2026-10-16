import { NextResponse } from 'next/server';
import fs from 'fs';
import { getArtifactPath } from '@/lib/artifacts';
import { INITIAL_DIRECTIVES } from '@/data/mockData';
import { MunicipalDirective } from '@/types/dashboard';

export async function GET() {
  try {
    const directivesPath = getArtifactPath('directives.jsonl');

    if (directivesPath && fs.existsSync(directivesPath)) {
      const content = fs.readFileSync(directivesPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);

      const parsed: MunicipalDirective[] = [];
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          parsed.push({
            id: item.id || item.directive_id || `DIR-${Math.random().toString(36).substring(2, 7)}`,
            timestamp: item.timestamp || new Date().toISOString(),
            intersection_id: item.intersection_id || 'junction_01',
            actions: item.actions || [],
            estimated_co2_saved_g: item.estimated_co2_saved_g ?? 0,
            confidence: item.confidence ?? 0.85,
            rationale: item.rationale || 'Real-time municipal heuristic directive.',
            mode: item.mode === 'llm' ? 'llm' : 'rules_fallback',
            status: item.status || (item.approved ? 'approved' : 'pending'),
          });
        } catch (lineErr) {
          console.warn('Skipping unparseable directive line:', lineErr);
        }
      }

      if (parsed.length > 0) {
        return NextResponse.json({
          success: true,
          isFallback: false,
          count: parsed.length,
          source: 'artifacts/directives.jsonl',
          directives: parsed,
        });
      }
    }

    // Graceful fallback to initial mock directives
    return NextResponse.json({
      success: true,
      isFallback: true,
      count: INITIAL_DIRECTIVES.length,
      source: 'fallback_mock_data',
      directives: INITIAL_DIRECTIVES,
    });
  } catch (error) {
    console.error('Error serving /api/directives:', error);
    return NextResponse.json({
      success: false,
      isFallback: true,
      count: INITIAL_DIRECTIVES.length,
      source: 'fallback_mock_data',
      error: String(error),
      directives: INITIAL_DIRECTIVES,
    });
  }
}
