export interface EngineMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}
