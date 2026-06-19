export class FigmaRestClient {
  private token: string;
  private baseUrl = "https://api.figma.com/v1";
  private fileCache = new Map<string, { data: any; ts: number }>();
  private FILE_TTL = 30_000; // 30 s — avoids repeated full-file downloads

  constructor(token: string) {
    this.token = token;
  }

  private async apiFetch<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "X-Figma-Token": this.token },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Figma API ${res.status}: ${res.statusText} — ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async getFile(fileKey: string): Promise<any> {
    const cached = this.fileCache.get(fileKey);
    if (cached && Date.now() - cached.ts < this.FILE_TTL) return cached.data;
    const data = await this.apiFetch<any>(`/files/${fileKey}`);
    this.fileCache.set(fileKey, { data, ts: Date.now() });
    return data;
  }

  invalidateFile(fileKey: string): void {
    this.fileCache.delete(fileKey);
  }

  getFileNodes(fileKey: string, nodeIds: string[]) {
    const ids = nodeIds.join(",");
    return this.apiFetch<any>(`/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`);
  }

  getLocalVariables(fileKey: string) {
    return this.apiFetch<any>(`/files/${fileKey}/variables/local`);
  }

  getStyles(fileKey: string) {
    return this.apiFetch<any>(`/files/${fileKey}/styles`);
  }
}
