import { Metrics, SweepResult, VenueLayout, SimConfig } from '../models/types';

export function exportResultsJSON(
  metrics: Metrics,
  config: SimConfig,
  layout: VenueLayout,
  sweepResults: SweepResult[],
): void {
  const data = { timestamp: new Date().toISOString(), config, layout, metrics, sweepResults };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  download(blob, 'crowd-sim-results.json');
}

export function exportResultsCSV(metrics: Metrics, sweepResults: SweepResult[]): void {
  const lines: string[] = [
    'metric,value',
    `simTime,${metrics.simTime.toFixed(1)}`,
    `exitedAgents,${metrics.exitedAgents}`,
    `peakDensity,${metrics.peakDensity.toFixed(2)}`,
    `avgEgressTime,${metrics.avgEgressTime.toFixed(1)}`,
    `p95EgressTime,${metrics.p95EgressTime.toFixed(1)}`,
    `timeAboveWarning,${metrics.timeAboveWarning.toFixed(1)}`,
    `timeAboveDanger,${metrics.timeAboveDanger.toFixed(1)}`,
    '',
    'sweepN,peakDensity,p95EgressTime,timeAboveWarningPct,passed',
    ...sweepResults.map(r =>
      `${r.N},${r.peakDensity.toFixed(2)},${r.p95EgressTime.toFixed(2)},${r.timeAboveWarningPct.toFixed(1)},${r.passed}`
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  download(blob, 'crowd-sim-results.csv');
}

export function exportVenueJSON(layout: VenueLayout): void {
  const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
  download(blob, 'venue-layout.json');
}

export function loadVenueJSON(file: File): Promise<VenueLayout> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try { resolve(JSON.parse(e.target!.result as string) as VenueLayout); }
      catch { reject(new Error('Invalid JSON')); }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsText(file);
  });
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
