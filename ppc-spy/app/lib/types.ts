export interface KeywordResult {
  keyword: string;
  searchVolume: number;
  cpc: number;
  competition: number;
  domain1Pos: number | null;
}

export interface AdResult {
  keyword: string;
  headline: string;
  description: string;
  displayUrl: string;
  position: number | null;
}

export type SortField = keyof KeywordResult;
export type SortDir = "asc" | "desc";
