/// <reference types="vite/client" />

declare module "opensheetmusicdisplay" {
  export class OpenSheetMusicDisplay {
    constructor(container: HTMLElement, options?: Record<string, unknown>);
    load(xml: string): Promise<void>;
    render(): Promise<void>;
  }
}
