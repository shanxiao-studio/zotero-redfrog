import { HelperExampleFactory,KeyExampleFactory } from "./examples";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";

export function registerShortcuts() {
  ztoolkit.Keyboard.register((ev, data) => {
    const ifUpdateJournalInfo = getPref(`shortcut.update.journal.info`);
    const keyUpdateJournalInfo = getPref(`shortcut.input.update.journal.info`);
    const ifTitleSentence = getPref(`shortcut.title.sentence.case`);
    const keyTitleSentence = getPref(`shortcut.input.title.sentence.case`);
    const ifPubTitleCase = getPref(`shortcut.publication.title.case`);
    const keyPubTitleCase = getPref(`shortcut.input.publication.title.case`);
    const ifDataDir = getPref(`shortcut.data.dir`);
    const keyDataDir = getPref(`shortcut.input.data.dir`);
    const ifProfileDir = getPref(`shortcut.profile.dir`);
    const keyProfileDir = getPref(`shortcut.input.profile.dir`);

    // win的control 键 mac的command键  accel是控制键，在mac对应command，在其他系统对应ctrl
    if (Zotero.isMac) {
      var keyControl = "meta";
    } else {
      var keyControl = "control";
    }

    if (data.type === "keyup" && data.keyboard) {
      // 从easyScholar更新期刊信息
      if (data.keyboard.equals(`${keyControl},${keyUpdateJournalInfo}`)) {
        if (ifUpdateJournalInfo) {
          const itemID = Zotero_Tabs._tabs[Zotero_Tabs.selectedIndex].data.itemID;
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
        if (ifTitleSentence) {
          HelperExampleFactory.chanItemTitleCase();
        }
      }
      // 期刊名称大小写
      if (data.keyboard.equals(`${keyControl},${keyPubTitleCase}`)) {
        if (ifPubTitleCase) {
          HelperExampleFactory.chPubTitleCase();
        }
      }
      // 显示数据目录
      if (data.keyboard.equals(`alt,${keyDataDir}`)) {
        if (ifDataDir) {
          HelperExampleFactory.progressWindow(
            `${getString("dataDir")} ${Zotero.DataDirectory.dir}`,
            "success",
          );
        }
      }
      // 显示配置配置目录
      if (data.keyboard.equals(`alt,${keyProfileDir}`)) {
        if (ifProfileDir) {
          HelperExampleFactory.progressWindow(
            `${getString("proDir")} ${Zotero.Profile.dir}`,
            "success",
          );
        }
      }
    }
  });
}