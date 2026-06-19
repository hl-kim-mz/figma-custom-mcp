export class FigmaRestClient {
  private token: string;
  private baseUrl = "https://api.figma.com/v1";

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

  getFile(fileKey: string) {
    return this.apiFetch<any>(`/files/${fileKey}`);
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
