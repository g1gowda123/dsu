import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getArtifactPath } from '@/lib/artifacts';
import { generateTelemetryData } from '@/data/mockData';
import { TelemetryPoint } from '@/types/dashboard';

export async function GET() {
  try {
    const seriesPath = getArtifactPath('telemetry_series.json');
    const parquetPath = getArtifactPath('telemetry.parquet');

    // 1. Check if pre-aggregated series exists
    if (seriesPath && fs.existsSync(seriesPath)) {
      try {
        const raw = fs.readFileSync(seriesPath, 'utf-8');
        const data = JSON.parse(raw);
        return NextResponse.json({
          success: true,
          isFallback: false,
          source: 'artifacts/telemetry.parquet',
          durationSec: data.metadata?.maxTimeSec || 96.5,
          maxTimeSec: data.metadata?.maxTimeSec || 96.5,
          totalTracks: data.metadata?.totalTracks || 124,
          points: data.points as TelemetryPoint[],
          vehiclesByTime: data.vehiclesByTime || {},
        });
      } catch (err) {
        console.warn('Failed parsing telemetry_series.json, attempting regeneration:', err);
      }
    }

    // 2. If series json does not exist but parquet does, try generating it via python
    if (parquetPath && fs.existsSync(parquetPath)) {
      try {
        const scriptCandidates = [
          path.resolve(process.cwd(), '..', 'scripts', 'export_telemetry_series.py'),
          path.resolve(process.cwd(), 'scripts', 'export_telemetry_series.py'),
        ];
        const scriptPath = scriptCandidates.find((p) => fs.existsSync(p));
        if (scriptPath) {
          execSync(`python "${scriptPath}"`, { timeout: 15000 });
          if (seriesPath && fs.existsSync(seriesPath)) {
            const raw = fs.readFileSync(seriesPath, 'utf-8');
            const data = JSON.parse(raw);
            return NextResponse.json({
              success: true,
              isFallback: false,
              source: 'artifacts/telemetry.parquet',
              durationSec: data.metadata?.maxTimeSec || 96.5,
              maxTimeSec: data.metadata?.maxTimeSec || 96.5,
              totalTracks: data.metadata?.totalTracks || 124,
              points: data.points as TelemetryPoint[],
              vehiclesByTime: data.vehiclesByTime || {},
            });
          }
        }
      } catch (genErr) {
        console.warn('Could not run Python export script:', genErr);
      }
    }

    // 3. Graceful Fallback Cache: Offline demo mode with realistic generated telemetry
    const fallbackPoints = generateTelemetryData();
    return NextResponse.json({
      success: true,
      isFallback: true,
      source: 'fallback_mock_generator',
      durationSec: 120,
      maxTimeSec: 120,
      totalTracks: 412,
      points: fallbackPoints,
      vehiclesByTime: {},
    });
  } catch (error) {
    console.error('Unhandled error in /api/telemetry:', error);
    const fallbackPoints = generateTelemetryData();
    return NextResponse.json({
      success: false,
      isFallback: true,
      error: String(error),
      durationSec: 120,
      maxTimeSec: 120,
      totalTracks: 412,
      points: fallbackPoints,
      vehiclesByTime: {},
    });
  }
}
