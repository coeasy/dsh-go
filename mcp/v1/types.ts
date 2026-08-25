export interface MCPServerManifest {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  permissions: {
    network?: boolean;
    filesystem?: boolean;
  };
}
