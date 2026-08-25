export interface LoadItem {
  id: string;
  version: string;
  dependencies: string[];
}

export interface RuntimeLoadPlan {
  order: LoadItem[];
  createdAt: string;
}
