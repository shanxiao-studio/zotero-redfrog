import { HelperExampleFactory, KeyExampleFactory } from "./examples";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";

export function registerShortcuts() {
  ztoolkit.Keyboard.register((ev: KeyboardEvent, data: any) => {
    const ifUpdateJournalInfo = getPref(`shortcut.update.journal.info`);
    const keyUpdateJournalInfo = getPref(`shortcut.input.update.journal.info`);
    const ifTitleSentence = getPref(`shortcut.title.sentence.case`);
    const keyTitleSentence = getPref(`shortcut.input.title.sentence.case`);
    const ifPubTitleCase = getPref(`shortcut.publication.title.case`);
    const keyPubTitleCase = getPref(`shortcut.input.publication.title.case`);
    const ifDataDir = getPref(`shortcut.data.dir`);
    const keyDataDir = getPref(`shortcut.input.data.dir`) as string;
    const ifProfileDir = getPref(`shortcut.profile.dir`);
    const keyProfileDir = getPref(`shortcut.input.profile.dir`) as string;

    // win的control 键 mac的command键  accel是控制键，在mac对应command，在其他系统对应ctrl
    const keyControl = Zotero.isMac ? "meta" : "control";

    if (data.type === "keyup" && data.keyboard) {
      // 从easyScholar更新期刊信息
      if (data.keyboard.equals(`${keyControl},${keyUpdateJournalInfo}`)) {
        if (ifUpdateJournalInfo && keyUpdateJournalInfo !== "") {
          const itemID =
            Zotero_Tabs._tabs[Zotero_Tabs.selectedIndex].data.itemID;
          // do nothing when trigger in the reader tab
          if (itemID) {
            return;
          } else if (KeyExampleFactory.getSelectedItems()) {
            KeyExampleFactory.setExtraItems();
          } else {
            return;
          }
        }
      }
      // 题目大小写改为句首字母大小写
      if (data.keyboard.equals(`${keyControl},${keyTitleSentence}`)) {
        if (ifTitleSentence && keyTitleSentence !== "") {
          HelperExampleFactory.chanItemTitleCase();
        }
      }
      // 期刊名称大小写
      if (data.keyboard.equals(`${keyControl},${keyPubTitleCase}`)) {
        if (ifPubTitleCase && keyPubTitleCase !== "") {
          HelperExampleFactory.chPubTitleCase();
        }
      }
      // 显示数据目录 Alt+D
      if (
        data.keyboard.equals(`alt,${keyDataDir}`) ||
        data.keyboard.equals(
          `alt,${getModifiedCharacter(keyDataDir, "option")}`,
        )
      ) {
        if (ifDataDir && keyDataDir !== "") {
          HelperExampleFactory.progressWindow(
            `${getString("dataDir")} ${Zotero.DataDirectory.dir}`,
            "success",
          );
        }
      }
      // 显示配置目录 Alt+P
      if (
        data.keyboard.equals(`alt,${keyProfileDir}`) ||
        data.keyboard.equals(
          `alt,${getModifiedCharacter(keyProfileDir, "option")}`,
        )
      ) {
        if (ifProfileDir && keyProfileDir !== "") {
          HelperExampleFactory.progressWindow(
            // @ts-ignore - Plugin instance is not typed
            `${getString("proDir")} ${Zotero.Profile.dir}`,
            "success",
          );
        }
      }
    }
  });
  // key Map for MacOS
  type KeyModifiers = { option: string };

  type KeyboardMap = Record<string, KeyModifiers>;

  const macKeyboardMap: KeyboardMap = {
    q: { option: "œ" },
    w: { option: "∑" },
    e: { option: "´" },
    r: { option: "®" },
    t: { option: "†" },
    y: { option: "¥" },
    u: { option: "¨" },
    i: { option: "^" },
    o: { option: "ø" },
    p: { option: "π" },
    a: { option: "å" },
    s: { option: "ß" },
    d: { option: "∂" },
    f: { option: "ƒ" },
    g: { option: "©" },
    h: { option: "˙" },
    j: { option: "∆" },
    k: { option: "˚" },
    l: { option: "¬" },
    z: { option: "Ω" },
    x: { option: "≈" },
    c: { option: "ç" },
    v: { option: "√" },
    b: { option: "∫" },
    n: { option: "˜" },
    m: { option: "µ" },
  };

  function getModifiedCharacter(
    inputChar: string,
    modifier: keyof KeyModifiers,
  ): string | null {
    const normalizedInputChar = inputChar.toLowerCase();
    return macKeyboardMap[normalizedInputChar]?.[modifier] ?? null;
  }
}
