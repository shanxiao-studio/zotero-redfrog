declare const _globalThis: {
  [key: string]: any;
  Zotero: _ZoteroTypes.Zotero;
  ZoteroPane: _ZoteroTypes.ZoteroPane;
  Zotero_Tabs: typeof Zotero_Tabs;
  window: Window;
  document: Document;
  ztoolkit: typeof ztoolkit;
  addon: typeof addon;
};

declare const ztoolkit: import("../src/addon").MyToolkit;
// declare const ztoolkit: import("zotero-plugin-toolkit").ZoteroToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const __env__: "production" | "development";

declare const Zotero: _ZoteroTypes.Zotero;
declare const ZoteroPane: _ZoteroTypes.ZoteroPane;
declare const Zotero_Tabs: typeof Zotero_Tabs;
declare const Localization: any;
declare const Components: any;
declare const Services: any;
declare const Cc: any;
declare const Ci: any;

declare namespace XUL {
  interface Checkbox {
    checked: boolean;
  }
}

declare namespace Zotero {
  type Item = any;
}

declare module "../src/addon" {
  interface MyToolkit {
    getGlobal(name: string): any;
    log(...args: any[]): void;
  }
}
