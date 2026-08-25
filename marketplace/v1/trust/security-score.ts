export interface SecurityScore {
  score: number;
  checks: string[];
}

export function calculateSecurityScore(): SecurityScore {
  return { score: 0, checks: [] };
}
