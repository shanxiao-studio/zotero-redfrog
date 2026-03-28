import { ProgressWindowHelper } from "zotero-plugin-toolkit";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { getAbbEx } from "./abb";

// 使用 getPref得到设置：只需要key即可。
// 形如var secretKey = getPref('secretkey')

function example(
  target: any,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
) {
  const original = descriptor.value;
  descriptor.value = function (...args: any) {
    try {
      ztoolkit.log(`Calling example ${target.name}.${String(propertyKey)}`);
      return original.apply(this, args);
    } catch (e) {
      ztoolkit.log(`Error in example ${target.name}.${String(propertyKey)}`, e);
      throw e;
    }
  };
  return descriptor;
}

function normalizeCustomDatasetCode(code: string): string {
  return code
    .trim()
    .replace(/\(.*?\)/g, "")
    .replace(/[\s\-_]+/g, "")
    .toUpperCase();
}

function parseCustomDatasetCodes(raw: unknown): string[] {
  if (typeof raw !== "string") {
    return [];
  }
  const codes = raw
    .split(/[,;\n]/)
    .map((code) => normalizeCustomDatasetCode(code))
    .filter((code) => code.length > 0);
  return Array.from(new Set(codes.map((code) => code.toUpperCase())));
}

function normalizeScholarTitle(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[“”"'`]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .trim();
}

function extractScholarYear(item: Zotero.Item): string | undefined {
  const yearRaw =
    ((item.getField("year") as string) || "").trim() ||
    ((item.getField("date") as string) || "").trim();
  return yearRaw.match(/\b(19|20)\d{2}\b/)?.[0];
}

function extractScholarAuthorKeywords(item: Zotero.Item): string[] {
  const creators = item.getCreators() || [];
  return creators
    .map((creator) => {
      const lastName = (creator.lastName || "").trim();
      const name = (creator.name || "").trim();
      return lastName || name;
    })
    .filter((name) => !!name)
    .slice(0, 3);
}

export class BasicExampleFactory {
  @example
  static registerNotifier() {
    const callback = {
      notify: async (
        event: string,
        type: string,
        ids: Array<string | number>,
        extraData: { [key: string]: any },
      ) => {
        if (!addon?.data.alive) {
          this.unregisterNotifier(notifierID);
          return;
        }
        addon.hooks.onNotify(event, type, ids, extraData);
        // 增加条目时
        // Zotero.Items.get(ids).filter(item => item.isRegularItem())
      },
    };

    // Register the callback in Zotero as an item observer

    const notifierID = Zotero.Notifier.registerObserver(callback, [
      "tab",
      "item",
      "file",
    ]);

    // Unregister callback when the window closes (important to avoid a memory leak)
    window.addEventListener(
      "unload",
      (e: Event) => {
        this.unregisterNotifier(notifierID);
      },
      false,
    );
  }

  @example
  static async exampleNotifierCallback(regularItems: any) {
    // 增加条目时 新增条目时
    //  Zotero.Items.get(ids).filter(item => item.isRegularItem())
    // var items = Zotero.Items.get(ids);
    // 增加条目时 更新
    const addUpdate = getPref(`add.update`);
    // 增加条目时 更新 条目题目改为句首字母大写
    const addItemTitleSentenceCase = getPref("update.title.sentence.case");
    // 增加条目时 更新 期刊题目改为词首字母大写
    const addPubTitleCase = getPref("update.publication.title.case");
    // 增加条目时 更新元数据
    const addUpMeta = getPref("add.upmeta");

    if (addUpdate) {
      await KeyExampleFactory.setExtra(regularItems);
    }

    if (addUpMeta) {
      await KeyExampleFactory.upMeta(regularItems);
    }

    if (addItemTitleSentenceCase) {
      HelperExampleFactory.chanItemTitleCaseDo(regularItems);
      // await KeyExampleFactory.setExtra(regularItems);
    }

    if (addPubTitleCase) {
      HelperExampleFactory.chPubTitleCase();
    }

    // 得到添加的条目总数
    // var items = Zotero.Items.get(ids);
    // Zotero.debug(`ccc添加条目了${ids}！`)
    // HelperExampleFactory.progressWindow(ids, "success");

    // HelperExampleFactory.progressWindow('ccc添加条目了${title}！', "success");
    // try {
    //   var items = Zotero.Items.get(ids);
    //   var item = items[0];
    //   var title = item.getField('title');
    //   HelperExampleFactory.progressWindow(`ccc添加条目了${title}！`, "success");
    // } catch (error) {
    //   Zotero.debug(error)
    // }
  }

  @example
  private static unregisterNotifier(notifierID: string) {
    Zotero.Notifier.unregisterObserver(notifierID);
  }

  @example
  static registerPrefs() {
    const prefOptions = {
      pluginID: config.addonID,
      src: rootURI + "chrome/content/preferences.xhtml",
      label: getString("prefs-title"),
      image: `chrome://${config.addonRef}/content/icons/favicon.png`,
      defaultXUL: true,
    };
    Zotero.PreferencePanes.register(prefOptions);
  }
}

export class KeyExampleFactory {
  private static googleScholarNextRequestAt = 0;

  private static googleScholarCooldownUntil = 0;

  private static googleScholarLastBlockedNoticeAt = 0;

  private static readonly GOOGLE_SCHOLAR_MIN_INTERVAL_MS = 3200;

  private static readonly GOOGLE_SCHOLAR_INTERVAL_JITTER_MS = 2200;

  private static readonly GOOGLE_SCHOLAR_BLOCK_NOTICE_GAP_MS = 120000;

  private static readonly GOOGLE_SCHOLAR_COOLDOWN_SHORT_MS = 2 * 60 * 1000;

  private static readonly GOOGLE_SCHOLAR_COOLDOWN_LONG_MS = 30 * 60 * 1000;

  private static now() {
    return Date.now();
  }

  private static isGoogleScholarCoolingDown() {
    return KeyExampleFactory.googleScholarCooldownUntil > KeyExampleFactory.now();
  }

  private static getGoogleScholarCooldownRemainingMs() {
    return Math.max(
      0,
      KeyExampleFactory.googleScholarCooldownUntil - KeyExampleFactory.now(),
    );
  }

  private static markGoogleScholarCooldown(ms: number, reason: string) {
    const now = KeyExampleFactory.now();
    const until = now + Math.max(0, ms);
    KeyExampleFactory.googleScholarCooldownUntil = Math.max(
      KeyExampleFactory.googleScholarCooldownUntil,
      until,
    );
    Zotero.debug(
      `Google Scholar 进入冷却 (${Math.round(ms / 1000)}s)，原因: ${reason}`,
    );
  }

  private static maybeNotifyGoogleScholarBlocked(reason: string) {
    const now = KeyExampleFactory.now();
    if (
      now - KeyExampleFactory.googleScholarLastBlockedNoticeAt <
      KeyExampleFactory.GOOGLE_SCHOLAR_BLOCK_NOTICE_GAP_MS
    ) {
      return;
    }
    KeyExampleFactory.googleScholarLastBlockedNoticeAt = now;
    HelperExampleFactory.progressWindow(
      `Google Scholar 触发限流/验证码，已暂停请求（${reason}）`,
      "fail",
    );
  }

  private static async waitForGoogleScholarRequestSlot() {
    const now = KeyExampleFactory.now();
    if (KeyExampleFactory.googleScholarNextRequestAt > now) {
      await Zotero.Promise.delay(KeyExampleFactory.googleScholarNextRequestAt - now);
    }
    const jitter = Math.round(
      Math.random() * KeyExampleFactory.GOOGLE_SCHOLAR_INTERVAL_JITTER_MS,
    );
    KeyExampleFactory.googleScholarNextRequestAt =
      KeyExampleFactory.now() +
      KeyExampleFactory.GOOGLE_SCHOLAR_MIN_INTERVAL_MS +
      jitter;
  }

  // 得到所选条目
  @example
  static getSelectedItems() {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    return items;
  }
  // 分类右击更新信息
  @example
  static async setExtraCol() {
    const itemsView = ZoteroPane.itemsView;
    let items: Zotero.Item[] | undefined;
    if (itemsView) {
      if (typeof itemsView.getVisibleItems === "function") {
        items = itemsView.getVisibleItems();
      } else if (typeof itemsView.getSortedItems === "function") {
        items = itemsView.getSortedItems();
      } else if (
        typeof itemsView.getRowCount === "function" &&
        typeof itemsView.getItemAtRow === "function"
      ) {
        const count = itemsView.getRowCount();
        items = [];
        for (let i = 0; i < count; i += 1) {
          const item = itemsView.getItemAtRow(i);
          if (item) {
            items.push(item);
          }
        }
      }
    }
    if (!items || items.length === 0) {
      const collection = ZoteroPane.getSelectedCollection();
      items = collection?.getChildItems();
    }
    if (!items || items.length === 0) {
      HelperExampleFactory.progressWindow(getString("zeroItem"), "fail");
      return;
    }
    await KeyExampleFactory.setExtra(items);
  }
  @example
  static async updateAllCol() {
    HelperExampleFactory.progressWindow(
      getString("update-journal-start"),
      "default",
    );
    await KeyExampleFactory.setExtraCol();
  }
  // 条目右键更新信息 右键菜单执行函数
  @example
  static async setExtraItems() {
    // var secretKey: any = Zotero.Prefs.get(`extensions.zotero.${config.addonRef}.secretkey`, true);
    const secretKey = getPref("secretkey");
    if (secretKey) {
      const items = Zotero.getActiveZoteroPane().getSelectedItems();
      await KeyExampleFactory.setExtra(items);
    } else {
      const alertInfo = getString("inputSecretkey");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
    }
  }

  @example
  static async setRatingItems(score: number) {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    await KeyExampleFactory.setRating(items, score);
  }

  @example
  static async setRating(items: Zotero.Item[], score: number) {
    if (!items || items.length === 0) {
      HelperExampleFactory.progressWindow(getString("zeroItem"), "fail");
      return;
    }
    for (const item of items) {
      if (UIExampleFactory.checkRatingItem(item)) {
        if (score <= 0) {
          ztoolkit.ExtraField.setExtraField(item, "评分", "");
        } else {
          ztoolkit.ExtraField.setExtraField(item, "评分", String(score));
        }
        await item.saveTx();
      }
    }
  }
  @example
  static async setExtra(items: any) {
    if (!items || items.length === 0) {
      HelperExampleFactory.progressWindow(getString("zeroItem"), "fail");
      return;
    }
    let n = 0;
    for (const item of items) {
      if (UIExampleFactory.checkItem(item)) {
        //如果是期刊或会议论文才继续
        const fullApiData = await KeyExampleFactory.getIFs(item); //得到easyscholar完整数据
        const easyscholarData = fullApiData?.officialRank?.all || null; //officialRank数据
        const chineseIFs = await KeyExampleFactory.getChineseIFs(item); //综合影响因子、复合影响因子

        //Zotero.debug('swuplLevel是' + swuplLevel);

        // 更新前清空Extra
        const emptyExtra = getPref(`update.empty.extra`);

        // 加: any为了后面不报错
        const jcr: any = getPref(`jcr.qu`);
        const updated: any = getPref(`updated`);
        const ifs: any = getPref(`sci.if`);
        const if5: any = getPref(`sci.if5`);
        const eii: any = getPref(`ei`);
        const sciUpTop: any = getPref(`sci.up.top`);
        const chjcscd: any = getPref(`chjcscd`);
        const pkucore: any = getPref(`pku.core`);
        const njucore: any = getPref(`nju.core`);
        const scicore: any = getPref(`sci.core`);
        const ssci: any = getPref(`ssci`);
        const ajg: any = getPref(`ajg`);
        const utd24: any = getPref(`utd24`);
        const ft50: any = getPref(`ft50`);
        const ccf: any = getPref(`ccf`);
        let ccfLevelFromEasy: string | number | undefined;
        const rankPartsCCF: string[] = [];
        const rankPartsEI: string[] = [];
        const rankPartsJCR: string[] = [];
        const rankPartsCAS: string[] = [];
        const rankPartsOther: string[] = [];
        const ifColumnParts: string[] = [];
        const itemType = Zotero.ItemTypes.getName(item.itemTypeID);
        const fms: any = getPref(`fms`);
        const jci: any = getPref(`jci`);
        const ahci: any = getPref(`ahci`);
        const esi: any = getPref(`esi`);
        const gsCites: any = getPref(`gs.cites`);
        const compoundIFs: any = getPref(`com.if`);
        const comprehensiveIFs: any = getPref(`agg.if`);
        //  大学期刊分类
        // 自定义数据集 custom dataset
        const caa = getPref(`caa`);
        const caai = getPref(`caai`);
        const customDatasetCodes = parseCustomDatasetCodes(
          getPref(`custom.dataset.codes`),
        );
        const datasetCodes = Array.from(
          new Set([
            ...(ccf ? ["CCF"] : []),
            ...(caa ? ["CAA"] : []),
            ...(caai ? ["CAAI"] : []),
            ...customDatasetCodes,
          ]),
        );
        const customDatasetLevels = KeyExampleFactory.getAllCustomLevels(
          fullApiData?.customRank,
          datasetCodes,
        );
        const scholarCitations = gsCites
          ? await KeyExampleFactory.getGoogleScholarCitations(item)
          : undefined;
        // 如果得到easyScholar、影响因子、法学数据或南农数据才算更新成功
        // 增加Scopus和ABDC更新检测
        const shouldUpdate =
          !!easyscholarData ||
          !!chineseIFs ||
          (gsCites && scholarCitations !== undefined) ||
          datasetCodes.some((code) => customDatasetLevels[code] !== undefined);

        if (!shouldUpdate) {
          continue;
        }

        const expectEasy =
          jcr ||
          updated ||
          ifs ||
          if5 ||
          eii ||
          sciUpTop ||
          chjcscd ||
          pkucore ||
          njucore ||
          scicore ||
          ssci ||
          ajg ||
          utd24 ||
          ft50 ||
          fms ||
          jci ||
          ahci ||
          esi ||
          ccf;
        const expectChineseIFs = compoundIFs || comprehensiveIFs;
        const expectScholar = gsCites;
        const expectCustomDataset = datasetCodes.length > 0;

        const fullUpdate =
          (!expectEasy || !!easyscholarData) &&
          (!expectChineseIFs || !!chineseIFs) &&
          (!expectScholar || scholarCitations !== undefined) &&
          (!expectCustomDataset ||
            datasetCodes.every(
              (code) => customDatasetLevels[code] !== undefined,
            ));

        if (emptyExtra && fullUpdate) {
          item.setField("extra", "");
        }
        n++;

        try {
          if (easyscholarData) {
            //如果得到easyscholar数据再写入
            // n++ //如果得到easyScholar数据才算更新成功
            // HelperExampleFactory.progressWindow(easyscholarData['sci'], 'success')
            if (ccf) {
              const ccfLevel = customDatasetLevels["CCF"] ?? ccfLevelFromEasy;
              if (ccfLevel !== undefined) {
                rankPartsCCF.push(`CCF-${String(ccfLevel)}`);
              }
            }
            if (updated && easyscholarData["sciUp"]) {
              const casValue = String(easyscholarData["sciUp"]);
              const casDisplay = casValue
                .replace(/[-_/]/g, " ")
                .replace(/(\d+)\s*区/g, "$1区")
                .replace(/\s+/g, " ")
                .trim();
              const casPrefixMap = [
                { pattern: /^计算机科学/, short: "计" },
                { pattern: /^医学/, short: "医" },
                { pattern: /^材料科学/, short: "材" },
                { pattern: /^物理学/, short: "物" },
                { pattern: /^化学/, short: "化" },
                { pattern: /^数学/, short: "数" },
                { pattern: /^生物学/, short: "生" },
                { pattern: /^地球科学/, short: "地" },
                { pattern: /^环境科学与生态学/, short: "环" },
                { pattern: /^工程技术/, short: "工" },
                { pattern: /^农学/, short: "农" },
                { pattern: /^社会科学/, short: "社" },
                { pattern: /^管理学/, short: "管" },
                { pattern: /^经济学/, short: "经" },
                { pattern: /^心理学/, short: "心" },
                { pattern: /^教育学/, short: "教" },
                { pattern: /^法学/, short: "法" },
                { pattern: /^文学/, short: "文" },
                { pattern: /^历史学/, short: "史" },
                { pattern: /^哲学/, short: "哲" },
                { pattern: /^艺术学/, short: "艺" },
              ];
              const matchedPrefix = casPrefixMap.find((item) =>
                item.pattern.test(casDisplay),
              );
              const casDisplayShort = matchedPrefix
                ? casDisplay.replace(matchedPrefix.pattern, matchedPrefix.short)
                : casDisplay.replace(
                    /^([\u4e00-\u9fa5])(?:[\u4e00-\u9fa5]+)?/,
                    "$1",
                  );
              rankPartsCAS.push(casDisplayShort);
            }
            if (chjcscd && easyscholarData["cscd"]) {
              rankPartsOther.push(`CSCD-${easyscholarData["cscd"]}`);
            }
            if (pkucore && easyscholarData["pku"]) {
              rankPartsOther.push("北大核心");
            }
            if (njucore && easyscholarData["cssci"]) {
              rankPartsOther.push(`CSSCI-${easyscholarData["cssci"]}`);
            }
            if (scicore && easyscholarData["zhongguokejihexin"]) {
              rankPartsOther.push("科技核心");
            }
            if (ssci && easyscholarData["ssci"]) {
              rankPartsOther.push(`SSCI-${easyscholarData["ssci"]}`);
            }
            if (ajg && easyscholarData["ajg"]) {
              rankPartsOther.push(`AJG-${easyscholarData["ajg"]}`);
            }
            if (utd24 && easyscholarData["utd24"]) {
              rankPartsOther.push(`UTD24-${easyscholarData["utd24"]}`);
            }
            if (ft50 && easyscholarData["ft50"]) {
              rankPartsOther.push(`FT50-${easyscholarData["ft50"]}`);
            }
            if (jcr && (easyscholarData["sci"] || easyscholarData["ssci"])) {
              const jcrValue =
                easyscholarData["sci"] != undefined
                  ? easyscholarData["sci"]
                  : easyscholarData["ssci"];
              if (jcrValue != undefined) {
                rankPartsJCR.push(String(jcrValue));
              }
            }
            if (ifs && easyscholarData["sciif"]) {
              ifColumnParts.push(`IF-${easyscholarData["sciif"]}`);
            }
            if (if5 && easyscholarData["sciif5"]) {
              ifColumnParts.push(`IF5-${easyscholarData["sciif5"]}`);
            }
            if (eii && easyscholarData["eii"]) {
              rankPartsEI.push("EI");
            }
            //if (sciUpTop && easyscholarData["sciUpTop"]) {
            if (sciUpTop) {
              if (easyscholarData["sciUpTop"]) {
                rankPartsCAS.push(`中科院TOP-${easyscholarData["sciUpTop"]}`);
              }
            }
            if (easyscholarData["ccf"]) {
              ccfLevelFromEasy = easyscholarData["ccf"];
            }
            if (fms && easyscholarData["fms"]) {
              rankPartsOther.push(`FMS-${easyscholarData["fms"]}`);
            }
            if (jci && easyscholarData["jci"]) {
              rankPartsOther.push(`JCI-${easyscholarData["jci"]}`);
            }
            if (ahci && easyscholarData["ahci"]) {
              rankPartsOther.push(`AHCI-${easyscholarData["ahci"]}`);
            }
            if (esi && easyscholarData["esi"]) {
              rankPartsOther.push(`ESI-${easyscholarData["esi"]}`);
            }
          }
        } catch (error) {
          Zotero.debug("影响因子设置失败！");
        }

        //复合影响因子、综合影响因子
        if (chineseIFs) {
          // 如果得到复合影响因子、综合影响因子再写入
          // if (!chineseIFs) { return } // 否则后面会报错
          if (compoundIFs) {
            ifColumnParts.push(`复合-${chineseIFs[0] ?? ""}`);
          }
          if (comprehensiveIFs) {
            ifColumnParts.push(`综合-${chineseIFs[1] ?? ""}`);
          }
        }

        const ifColumnValue = ifColumnParts.filter(Boolean).join("｜");
        if (ifColumnValue) {
          ztoolkit.ExtraField.setExtraField(item, "影响因子", ifColumnValue);
        }

        // 自定义数据集等级（不区分期刊/会议）
        const combinedDatasetCodes = ["CCF", "CAA", "CAAI"];
        if (caa) {
          const caaLevel = customDatasetLevels["CAA"];
          if (caaLevel !== undefined) {
            rankPartsOther.push(`CAA-${String(caaLevel)}`);
          }
        }
        if (caai) {
          const caaiLevel = customDatasetLevels["CAAI"];
          if (caaiLevel !== undefined) {
            rankPartsOther.push(`CAAI-${String(caaiLevel)}`);
          }
        }
        for (const code of datasetCodes) {
          if (combinedDatasetCodes.includes(code)) {
            continue;
          }
          const normalizedCode = normalizeCustomDatasetCode(code);
          if (normalizedCode === "EI" || normalizedCode === "EII") {
            if (!rankPartsEI.includes("EI")) {
              rankPartsEI.push("EI");
            }
            continue;
          }
          const level = customDatasetLevels[code];
          if (level !== undefined) {
            rankPartsOther.push(`${code}-${String(level)}`);
          }
        }
        const rankParts = [
          ...rankPartsCCF,
          ...rankPartsEI,
          ...rankPartsJCR,
          ...rankPartsCAS,
          ...rankPartsOther,
        ];
        const partitionParts = [
          ...rankPartsEI,
          ...rankPartsJCR,
          ...rankPartsCAS,
        ];
        if (partitionParts.length > 0) {
          ztoolkit.ExtraField.setExtraField(
            item,
            "分区",
            partitionParts.join("｜"),
          );
        }

        if (gsCites && scholarCitations !== undefined) {
          ztoolkit.ExtraField.setExtraField(
            item,
            "Google Scholar引用",
            scholarCitations !== undefined ? String(scholarCitations) : "",
          );
        }

        // 期刊缩写更新
        try {
          HelperExampleFactory.upJourAbb(item);
        } catch (error) {
          Zotero.debug("期刊缩写更新失败！");
        }
        item.saveTx();

        // 暂停1.x秒再抓取，随机等待时间1.xs

        await Zotero.Promise.delay(1000 + Math.round(Math.random() * 1000));
      }
    }

    // var whiteSpace = HelperExampleFactory.whiteSpace();
    if (n > 0) {
      HelperExampleFactory.progressWindow(
        getString("upIfsSuccess", { args: { count: n } }),
        "success",
      );
      // Zotero.debug('okkkk' + getString('upIfsSuccess', { args: { count: n } }));
    } else {
      HelperExampleFactory.progressWindow(`${getString("upIfsFail")}`, "fail");
    }
  }

  @example
  static buildGoogleScholarQueries(item: Zotero.Item): string[] {
    const titleRaw = (item.getField("title") as string) || "";
    const title = normalizeScholarTitle(titleRaw);
    if (!title) {
      return [];
    }

    const authorKeywords = extractScholarAuthorKeywords(item);
    const year = extractScholarYear(item);

    const strictQueryParts = [`"${title}"`];
    if (authorKeywords.length > 0) {
      strictQueryParts.push(authorKeywords.join(" "));
    }
    if (year) {
      strictQueryParts.push(year);
    }

    const relaxedQueryParts = [title];
    if (authorKeywords.length > 0) {
      relaxedQueryParts.push(authorKeywords.join(" "));
    }

    return Array.from(
      new Set(
        [strictQueryParts.join(" "), relaxedQueryParts.join(" "), title]
          .map((query) => query.trim())
          .filter((query) => !!query),
      ),
    );
  }

  @example
  static buildGoogleScholarSearchUrlFromQuery(query: string): string {
    const searchURL = new URL("https://scholar.google.com/scholar");
    searchURL.searchParams.set("hl", "en");
    searchURL.searchParams.set("q", query);
    searchURL.searchParams.set("as_vis", "0");
    searchURL.searchParams.set("as_sdt", "0,33");
    return searchURL.toString();
  }

  @example
  static hasGoogleScholarCaptcha(htmlText: string, responseUrl?: string): boolean {
    const source = htmlText || "";
    const url = responseUrl || "";
    return (
      source.includes("google.com/recaptcha") ||
      source.includes('id="gs_captcha_ccl"') ||
      source.includes("/sorry/image") ||
      /our systems have detected unusual traffic/i.test(source) ||
      /verify you'?re not a robot/i.test(source) ||
      /scholar\.google\.[^/]+\/sorry\//i.test(url)
    );
  }

  @example
  static parseGoogleScholarCitationsFromHtml(htmlText: string): string | undefined {
    if (!htmlText) {
      return;
    }

    const citationPatterns = [
      /scholar\?cites=[^"'\s>]+[^>]*>\s*(?:<[^>]+>\s*)*(?:Cited by|被引用|引用)\s*([0-9,]+)\s*</i,
      />(?:Cited by|被引用|引用)\s*([0-9,]+)</i,
      /(?:Cited by|被引用|引用)\s*([0-9,]+)/i,
    ];

    for (const pattern of citationPatterns) {
      const match = htmlText.match(pattern);
      if (match?.[1]) {
        return match[1].replace(/,/g, "");
      }
    }

    if (
      htmlText.includes('class="gs_r gs_or gs_scl"') ||
      htmlText.includes('class="gs_rt"')
    ) {
      return "0";
    }
  }

  @example
  static async fetchGoogleScholarCitationsByHttp(
    query: string,
  ): Promise<{ citations?: string; blocked?: boolean }> {
    if (KeyExampleFactory.isGoogleScholarCoolingDown()) {
      const remainMs = KeyExampleFactory.getGoogleScholarCooldownRemainingMs();
      Zotero.debug(
        `Google Scholar 仍在冷却中，跳过请求，剩余 ${Math.round(remainMs / 1000)}s`,
      );
      return { blocked: true };
    }

    const url = KeyExampleFactory.buildGoogleScholarSearchUrlFromQuery(query);
    Zotero.debug(`Google Scholar HTTP 回退查询: ${url}`);

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await KeyExampleFactory.waitForGoogleScholarRequestSlot();

        const resp = await Zotero.HTTP.request("GET", url, {
          successCodes: false,
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
            Referer: "https://scholar.google.com/",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          },
        });

        const status = Number(resp?.status || 0);
        const html = String(resp?.responseText || "");
        const responseUrl = String(resp?.responseURL || url);
        Zotero.debug(
          `Google Scholar HTTP 状态: ${status}, attempt: ${attempt}/${maxAttempts}`,
        );

        if (status === 429 || status === 503) {
          const retryDelay =
            1500 * Math.pow(2, attempt - 1) + Math.round(Math.random() * 1200);
          if (attempt < maxAttempts) {
            KeyExampleFactory.markGoogleScholarCooldown(
              retryDelay,
              `HTTP ${status}`,
            );
            await Zotero.Promise.delay(retryDelay);
            continue;
          }
          KeyExampleFactory.markGoogleScholarCooldown(
            KeyExampleFactory.GOOGLE_SCHOLAR_COOLDOWN_SHORT_MS,
            `HTTP ${status} 达到重试上限`,
          );
          KeyExampleFactory.maybeNotifyGoogleScholarBlocked(`HTTP ${status}`);
          return { blocked: true };
        }

        if (
          status === 403 ||
          KeyExampleFactory.hasGoogleScholarCaptcha(html, responseUrl)
        ) {
          Zotero.debug("Google Scholar 触发验证码或访问限制，停止当前查询");
          KeyExampleFactory.markGoogleScholarCooldown(
            KeyExampleFactory.GOOGLE_SCHOLAR_COOLDOWN_LONG_MS,
            "验证码/403",
          );
          KeyExampleFactory.maybeNotifyGoogleScholarBlocked("验证码/403");
          return { blocked: true };
        }

        if (status !== 200) {
          return {};
        }

        const parsed = KeyExampleFactory.parseGoogleScholarCitationsFromHtml(html);
        if (parsed !== undefined) {
          Zotero.debug(`Google Scholar 引用次数返回: ${parsed}`);
        } else {
          Zotero.debug("Google Scholar 未解析到引用次数");
        }
        return { citations: parsed };
      } catch (error: any) {
        Zotero.debug(`Google Scholar HTTP 查询失败: ${url}`);
        Zotero.debug(error);
        if (error?.message) {
          Zotero.debug(`Google Scholar HTTP 查询失败信息: ${String(error.message)}`);
        }

        if (attempt < maxAttempts) {
          const retryDelay =
            1200 * Math.pow(2, attempt - 1) + Math.round(Math.random() * 1200);
          await Zotero.Promise.delay(retryDelay);
          continue;
        }
        return {};
      }
    }

    return {};
  }

  @example
  static async getGoogleScholarCitations(
    item: Zotero.Item,
  ): Promise<string | undefined> {
    if (KeyExampleFactory.isGoogleScholarCoolingDown()) {
      const remainMs = KeyExampleFactory.getGoogleScholarCooldownRemainingMs();
      KeyExampleFactory.maybeNotifyGoogleScholarBlocked(
        `冷却剩余 ${Math.ceil(remainMs / 1000)}s`,
      );
      return;
    }

    const queries = KeyExampleFactory.buildGoogleScholarQueries(item);
    if (queries.length === 0) {
      Zotero.debug("Google Scholar 查询已跳过：无有效查询词");
      return;
    }

    Zotero.debug("Google Scholar 开始执行查询流程");
    for (const query of queries) {
      const fallbackResult =
        await KeyExampleFactory.fetchGoogleScholarCitationsByHttp(query);
      if (fallbackResult.blocked) {
        return;
      }
      if (fallbackResult.citations !== undefined) {
        return fallbackResult.citations;
      }

      await Zotero.Promise.delay(1800 + Math.round(Math.random() * 1400));
    }

    Zotero.debug("Google Scholar 所有查询均未获取到引用次数");
    return;
  }

  @example
  // 从easyScholar获取数据 获得影响因子新接口函数
  static async getIFs(item: Zotero.Item) {
    const secretKey: any = getPref(`secretkey`);
    //得到查询字段，期刊用期刊题目，会议论文用会议名称
    let publicationTitle =
      Zotero.ItemTypes.getName(item.itemTypeID) == "journalArticle"
        ? encodeURIComponent(item.getField("publicationTitle") as any)
        : encodeURIComponent(item.getField("conferenceName") as any);

    // 处理PANS, 期刊中包含Proceedings of the National Academy of Sciences即为Proceedings of the National Academy of Sciences
    const pattPNAS = new RegExp(
      encodeURIComponent("Proceedings of the National Academy of Sciences"),
      "i",
    );
    const resultPNAS = pattPNAS.test(publicationTitle);
    publicationTitle = resultPNAS
      ? encodeURIComponent(
          "Proceedings of the National Academy of Sciences of the United States of America",
        )
      : publicationTitle;

    const url = `https://www.easyscholar.cc/open/getPublicationRank?secretKey=${secretKey}&publicationName=${publicationTitle}`;
    try {
      const resp = await Zotero.HTTP.request("GET", url);
      var updateJson = JSON.parse(resp.responseText);
      // 返回完整的 data 对象，包含 officialRank 和 customRank
      if (updateJson["data"]) {
        return updateJson["data"];
      } else {
        Zotero.debug("easyScholar中无此期刊");
        Zotero.debug(updateJson["msg"]);
      }
    } catch (e) {
      Zotero.debug("获取easyScholar信息失败");
      Zotero.debug(updateJson?.["msg"]);
    }
  }

  @example
  // 从已获取的 customRank 数据中解析所有自定义数据集等级（不再单独发请求）
  static getAllCustomLevels(
    customRankData: any,
    datasetCodes: string[],
  ): Record<string, string | number | undefined> {
    const result: Record<string, string | number | undefined> = {};
    if (datasetCodes.length === 0 || !customRankData) {
      return result;
    }
    try {
      const rankInfo = customRankData.rankInfo || [];
      const rankArray = customRankData.rank || [];

      for (const datasetCode of datasetCodes) {
        try {
          const normalizedCode =
            normalizeCustomDatasetCode(datasetCode).toLowerCase();
          // 优先精确匹配，再 startsWith 匹配
          let matchedInfo = rankInfo.find((entry: any) => {
            if (!entry) return false;
            if (String(entry.uuid || "").toLowerCase() === normalizedCode)
              return true;
            const normalized = normalizeCustomDatasetCode(
              String(entry.abbName || ""),
            ).toLowerCase();
            return normalized === normalizedCode;
          });
          if (!matchedInfo) {
            matchedInfo = rankInfo.find((entry: any) => {
              if (!entry) return false;
              const normalized = normalizeCustomDatasetCode(
                String(entry.abbName || ""),
              ).toLowerCase();
              return (
                normalized.startsWith(normalizedCode) &&
                normalizedCode.length > 0
              );
            });
          }
          if (!matchedInfo) {
            result[datasetCode] = undefined;
            continue;
          }
          const datasetUUID = matchedInfo.uuid;
          const allRankValues = Object.values(matchedInfo) as Array<
            string | number | undefined
          >;
          let rankValue: string | undefined;
          if (rankArray.length > 0) {
            const rankEntry = rankArray.find(
              (r: any) => typeof r === "string" && r.startsWith(datasetUUID),
            );
            if (rankEntry) {
              const andParts = rankEntry.split("&&&");
              if (andParts.length === 2) {
                rankValue = andParts[1];
              } else {
                const lastDash = rankEntry.lastIndexOf("-");
                if (lastDash !== -1) {
                  rankValue = rankEntry.slice(lastDash + 1);
                }
              }
            }
          }
          if (rankValue != undefined) {
            const rankIndex = parseInt(rankValue, 10);
            if (!Number.isNaN(rankIndex)) {
              result[datasetCode] = allRankValues[rankIndex + 1];
            }
          }
        } catch (e) {
          Zotero.debug(`解析自定义数据集 ${datasetCode} 失败: ${e}`);
        }
      }
    } catch (error) {
      Zotero.debug("解析自定义数据集期刊级别失败！" + error);
    }
    return result;
  }

  @example
  // 获取复合影响因子及综合影响因子代码源于@l0o0，感谢 20250722
  // 设置复合影响因子及综合影响因子20220709
  // 后续可用"https://kns.cnki.net/knavi/journals/searchbaseinfo", 20240929
  // 类似功能 https://github.com/MuiseDestiny/zotero-style/discussions/288
  // 代码源于@l0o0，@polygon不是茉莉花插件中的，感谢。
  static async getChineseIFs(item: Zotero.Item) {
    const chineseIFs: Array<string | number> = [];
    const pubT = item.getField("publicationTitle");
    const pattern = new RegExp("[\u4E00-\u9FA5]+");
    if (pattern.test(String(pubT))) {
      // 如果期刊名中含有中文才进行替换
      try {
        // const formData = new window.FormData();
        // formData.append("searchStateJson", `{"StateID":"","Platfrom":"","QueryTime":"","Account":"knavi","ClientToken":"","Language":"","CNode":{"PCode":"SQN63324","SMode":"","OperateT":""},"QNode":{"SelectT":"","Select_Fields":"","S_DBCodes":"","QGroup":[{"Key":"subject","Logic":1,"Items":[],"ChildItems":[{"Key":"txt","Logic":1,"Items":[{"Key":"txt_1","Title":"","Logic":1,"Name":"TI","Operate":"%","Value":"'${pubT}'","ExtendType":0,"ExtendValue":"","Value2":""}],"ChildItems":[]}]}],"OrderBy":"OTA|DESC","GroupBy":"","Additon":""}}`);
        // formData.append("displaymode", "1");
        // formData.append("pageindex", "1");
        // formData.append("pagecount", "21");
        // formData.append("searchType", "刊名(曾用刊名)");
        // formData.append("switchdata", "search");

        // const res = await Zotero.HTTP.request("POST",
        //   "https://kns.cnki.net/knavi/journals/searchbaseinfo",
        //   {
        //     headers: {
        //       "Content-Type": "multipart/form-data"
        //     },
        //     body: formData as any
        //   }
        // ) //注释时间 20270722
        // const journalName = "食品科学";
        const resp = await Zotero.HTTP.request(
          "GET",
          `http://121.196.229.180:8080/v1/journals/cnki/${encodeURI(pubT)}`,
          { headers: { pluginID: "redfrog@redleafnew.me" } },
        );
        // return JSON.parse(resp.responseText);

        // const compoundIF = res.responseText.match(/复合影响因子：([\d\.]+)/)?.[1]
        // const comprehensiveIF = res.responseText.match(/综合影响因子：([\d\.]+)/)?.[1] //20250722
        const compoundIF = JSON.parse(resp.responseText).data.fhyz;
        const comprehensiveIF = JSON.parse(resp.responseText).data.zhyz;

        if (compoundIF !== undefined) {
          chineseIFs.push(compoundIF);
          Zotero.debug("复合影响因子是： " + compoundIF);
        }
        if (comprehensiveIF !== undefined) {
          chineseIFs.push(comprehensiveIF);
        }
        return chineseIFs;
      } catch (e) {
        Zotero.debug("复合影响因子、综合影响因子获取失败！");
        return;
      }
    }
  }

  //分类右击更新信息
  @example
  static async upMetaCol() {
    const collection = ZoteroPane.getSelectedCollection();
    const items = collection?.getChildItems();
    await KeyExampleFactory.upMeta(items);
  }
  //条目右键更新信息
  @example
  static async upMetaItems() {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    await KeyExampleFactory.upMeta(items);
  }

  @example
  //更新元数据执行函数
  // 代码来源于Quick动作
  //https://getquicker.net/Sharedaction?code=78da8f40-e73a-46e8-da6b-08da76a0d1ac和
  // https://getquicker.net/Sharedaction?code=305c5f6e-4f15-445c-996a-08dace1ee4e7
  //感谢@ttChen老师的源代码
  static async upMeta(items: any) {
    // var items = KeyExampleFactory.getSelectedItems();
    // var item = items[0];
    let n = 0;
    const pattern = new RegExp("[\u4E00-\u9FA5]+");
    for (const item of items) {
      if (UIExampleFactory.checkItem(item)) {
        //如果期刊或会议论文才继续
        var title: any = item.getField("title");
        const doi = item.getField("DOI");
        const lan = pattern.test(title) ? "zh-CN" : "en-US";
        if (lan == "zh-CN") {
          //中文条目
          async function getCNKIDetailURLByTitle(title: any) {
            const queryJson = {
              Platform: "",
              DBCode: "CFLS",
              KuaKuCode:
                "CJFQ,CCND,CIPD,CDMD,BDZK,CISD,SNAD,CCJD,GXDB_SECTION,CJFN,CCVD",
              QNode: {
                QGroup: [
                  {
                    Key: "Subject",
                    Title: "",
                    Logic: 1,
                    Items: [
                      {
                        Title: "篇名",
                        Name: "TI",
                        Value: title,
                        Operate: "%=",
                        BlurType: "",
                      },
                    ],
                    ChildItems: [],
                  },
                ],
              },
            };

            const PostDATA =
              "IsSearch=true&QueryJson=" +
              encodeURIComponent(JSON.stringify(queryJson)) +
              `&PageName=defaultresult&DBCode=CFLS&KuaKuCodes=CJFQ%2CCCND%2CCIPD%2CCDMD%2CBDZK%2CCISD%2CSNAD%2CCCJD%2CGXDB_SECTION%2CCJFN%2CCCVD` +
              `&CurPage=1&RecordsCntPerPage=20&CurDisplayMode=listmode&CurrSortField=RELEVANT&CurrSortFieldType=desc&IsSentenceSearch=false&Subject=`;

            function getCookieSandbox() {
              const cookieData = `Ecp_ClientId=3210724131801671689;
            cnkiUserKey=2bf7144a-ddf6-3d32-afb8-d4bf82473d9f;
            RsPerPage=20;
            Ecp_ClientIp=58.154.105.222;
            Ecp_Userid=5002973;
            Hm_lvt_38f33a73da35494cc56a660420d5b6be=1657977228,1658755426,1659774372,1659793220;
            UM_distinctid=183d49fcff858b-0941bfea87e982-76492e2f-384000-183d49fcff9119c;
            knsLeftGroupSelectItem=1%3B2%3B; dsorder=relevant;
            _pk_ref=%5B%22%22%2C%22%22%2C1669645320%2C%22https%3A%2F%2Feasyscholar.cc%2F%22%5D;
            _pk_id=c26caf7b-3374-4899-9370-488df5c09825.1661393760.22.1669645320.1669645320.;
            Ecp_loginuserbk=db0172; Ecp_IpLoginFail=22113066.94.113.19;
            ASP.NET_SessionId=5mzsjs1nrl1tf0b5ec450grz; SID_kns8=123152;
            CurrSortField=%e7%9b%b8%e5%85%b3%e5%ba%a6%2frelevant%2c(%e5%8f%91%e8%a1%a8%e6%97%b6%e9%97%b4%2c%27time%27);
            CurrSortFieldType=DESC; dblang=ch`;

              const userAgent =
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.56";
              const url = "https://cnki.net/";
              // @ts-ignore - Plugin instance is not typed
              return new Zotero.CookieSandbox("", url, cookieData, userAgent);
            }

            const requestHeaders = {
              Accept: "text/html, */*; q=0.01",
              "Accept-Encoding": "gzip, deflate, br",
              "Accept-Language":
                "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
              Connection: "keep-alive",
              "Content-Length": "992",
              "Content-Type":
                "application/x-www-form-urlencoded; charset=UTF-8",
              Host: "kns.cnki.net",
              Origin: "https://kns.cnki.net",
              Referer: `https://kns.cnki.net/kns8/defaultresult/index?kw=${encodeURIComponent(title)}&korder=TI`,
              "Sec-Fetch-Dest": "empty",
              "Sec-Fetch-Mode": "cors",
              "Sec-ch-ua": `"Microsoft Edge"; v = "107", "Chromium"; v = "107", "Not=A?Brand"; v = "24"`,
              "Sec-Fetch-Site": "same-origin",
              "X-Requested-With": "XMLHttpRequest",
            };

            const postUrl = "https://kns.cnki.net/kns8/Brief/GetGridTableHtml";

            function getHtml(responseText: any) {
              // @ts-ignore - Plugin instance is not typed
              const parser = Components.classes[
                "@mozilla.org/xmlextras/domparser;1"
                // @ts-ignore - Plugin instance is not typed
              ].createInstance(Components.interfaces.nsIDOMParser);
              const html = parser.parseFromString(responseText, "text/html");
              return html;
            }
            const resp = await Zotero.HTTP.request("POST", postUrl, {
              headers: requestHeaders,
              cookieSandbox: getCookieSandbox(),
              body: PostDATA,
            });
            return getHtml(resp.responseText);
          }
          function updateField(field: any, newItem: any, oldItem: Zotero.Item) {
            const newFieldValue = newItem[field],
              oldFieldValue = oldItem.getField(field);
            if (newFieldValue && newFieldValue !== oldFieldValue) {
              oldItem.setField(field, newFieldValue);
            }
          }
          function updateINFO(newItem: any, oldItemID: any) {
            const oldItem = Zotero.Items.get(oldItemID);
            oldItem.setCreators(newItem["creators"]);
            // 可根据下述网址增减需要更新的Field.
            // https://www.zotero.org/support/dev/client_coding/javascript_api/search_fields
            const fields = [
              "title",
              "publicationTitle",
              "journalAbbreviation",
              "volume",
              "issue",
              "date",
              "pages",
              "ISSN",
              "url",
              "abstractNote",
              "DOI",
              "type",
              "publisher",
            ];
            for (const field of fields) {
              updateField(field, newItem, oldItem);
            }
            oldItem.saveTx();
            Zotero.debug("succeeded!");
          }
          //中文条目更新函数
          const selectedItem = item;
          var ItemID = selectedItem.id;
          var title: any = selectedItem.getField("title");
          const publicationTitle = selectedItem.getField("publicationTitle");
          var html;
          var url;
          try {
            html = await getCNKIDetailURLByTitle(title);
            if (publicationTitle != "") {
              url = (Zotero.Utilities as any).xpath(
                html,
                `//td[normalize-space(string(.))="${publicationTitle}"]/preceding-sibling::td[@class="name" and normalize-space(string(.))="${title}"]/a`,
              )[0].href;
            } else {
              url = (Zotero.Utilities as any).xpath(
                html,
                `//td[@class="name" and normalize-space(string(.))="${title}"]/a`,
              )[0].href;
            }

            url = url.replace(
              "/kns8/Detail",
              "https://kns.cnki.net/kcms/detail/detail.aspx",
            );
          } catch (error) {
            const popw = new Zotero.ProgressWindow();
            popw.changeHeadline("未找到文献, 或者遇到了网络问题！", "", "");
            popw.addDescription(`文献：${title}`);
            popw.show();
            popw.startCloseTimer(5 * 1000);

            return;
          }
          // @ts-ignore - loadDocuments exists in Zotero runtime but is missing from TS definitions
          Zotero.HTTP.loadDocuments(url, async function (doc: any) {
            const translate = new Zotero.Translate.Web();
            translate.setDocument(doc);
            translate.setTranslator("5c95b67b-41c5-4f55-b71a-48d5d7183063");
            const items = await translate.translate({ libraryID: false });
            if (items.length == 0) return;
            updateINFO(items[0], ItemID);
          });
        } else if (lan == "en-US") {
          //英文条目
          if (doi != "") {
            const identifier = {
              itemType: "journalArticle",
              DOI: item.getField("DOI"),
            };
            const translate = new Zotero.Translate.Search();
            translate.setIdentifier(identifier);
            const translators = await translate.getTranslators();
            translate.setTranslator(translators);
            const newItems = await translate.translate({ libraryID: false });
            if (newItems.length == 0) continue;
            const newItem = newItems[0];

            function update(field: any) {
              const newFieldValue = newItem[field],
                oldFieldValue = item.getField(field);
              if (newFieldValue && newFieldValue !== oldFieldValue) {
                item.setField(field, newFieldValue);
              }
            }
            item.setCreators(newItem["creators"]);

            // 可根据下述网址增减需要更新的Field.
            // https://www.zotero.org/support/dev/client_coding/javascript_api/search_fields

            const fields = [
              "title",
              "publicationTitle",
              "journalAbbreviation",
              "volume",
              "issue",
              "date",
              "pages",
              "issue",
              "ISSN",
              "url",
              "abstractNote",
            ];

            for (const field of fields) {
              update(field);
            }

            await item.saveTx();
          }
        }
        n++;
        await Zotero.Promise.delay(1000 + Math.round(Math.random() * 1000)); // 暂停1s
      }
    }
    if (n > 0) {
      HelperExampleFactory.progressWindow(
        getString("upIfsSuccess", { args: { count: n } }),
        "success",
      );
      // Zotero.debug('okkkk' + getString('upIfsSuccess', { args: { count: n } }));
    } else {
      HelperExampleFactory.progressWindow(`${getString("upIfsFail")}`, "fail");
    }
    // var whiteSpace = HelperExampleFactory.whiteSpace();
    // HelperExampleFactory.progressWindow(`${n}${whiteSpace}${getString('upIfsSuccess')}`, 'success')
  }

  @example
  static exampleShortcutConflictionCallback() {
    return;
    // const conflictionGroups = ztoolkit.Shortcut.checkAllKeyConflicting();
    // new ztoolkit.ProgressWindow("Check Key Confliction")
    //   .createLine({
    //     text: `${conflictionGroups.length} groups of confliction keys found. Details are in the debug output/console.`,
    //   })
    //   .show(-1);
    // ztoolkit.log(
    //   "Conflictions:",
    //   conflictionGroups,
    //   "All keys:",
    //   ztoolkit.Shortcut.getAll()
    // );
  }
}

export class UIExampleFactory {
  // 是否显示菜单函数 类型为期刊才显示可用
  // 是否显示分类右键菜单 隐藏
  static displayColMenuitem() {
    const collection = ZoteroPane.getSelectedCollection(),
      menuUpIFsCol = document.getElementById(
        `zotero-collectionmenu-${config.addonRef}-upifs`,
      ), // 删除分类及附件菜单
      menuUpMeta = document.getElementById(
        `zotero-collectionmenu-${config.addonRef}-upmeta`,
      ); // 导出分类附件菜单

    // 非正常文件夹，如我的出版物、重复条目、未分类条目、回收站，为false，此时返回值为true，禁用菜单
    // 两个！！转表达式为逻辑值
    let showmenuUpIFsCol = !!collection;
    let showmenuUpMetaCol = !!collection;

    if (collection) {
      // 如果是正常分类才显示
      const items = collection.getChildItems();
      showmenuUpIFsCol = items.some((item) => UIExampleFactory.checkItem(item)); //检查是否为期刊或会议论文
      showmenuUpMetaCol = items.some((item) =>
        UIExampleFactory.checkItemMeta(item),
      ); // 更新元数据 中文有题目，英文检查是否有DOI
    } else {
      showmenuUpIFsCol = false;
    } // 检查分类是否有附件及是否为正常分类
    menuUpIFsCol?.setAttribute("disabled", String(!showmenuUpIFsCol)); // 禁用更新期刊信息
    menuUpMeta?.setAttribute("disabled", String(!showmenuUpMetaCol)); // 禁用更新元数据
  }

  // 禁用菜单
  // static disableMenu() {
  //   // 禁用添加条目更新期刊信息
  //   var menuUpAdd = document.getElementById('zotero-prefpane-redfrog-add-update');
  //   menuUpAdd?.setAttribute('disabled', 'ture');
  //   menuUpAdd?.setAttribute('hidden', 'ture');
  // }
  // 是否显示条目右键菜单
  static displayContexMenuitem() {
    const items = ZoteroPane.getSelectedItems(),
      menuUpIfs = document.getElementById(
        `zotero-itemmenu-${config.addonRef}-upifs`,
      ), // 更新期刊信息
      menuUpMeta = document.getElementById(
        `zotero-itemmenu-${config.addonRef}-upmeta`,
      ), // 更新元数据
      menuRating = document.getElementById(
        `zotero-itemmenu-${config.addonRef}-rating`,
      ), // 评分
      showMenuUpIfs = items.some((item) => UIExampleFactory.checkItem(item)), // 更新期刊信息 检查是否为期刊或会议论文
      showMenuUpMeta = items.some((item) =>
        UIExampleFactory.checkItemMeta(item),
      ), // 更新元数据 检查是否有DOI
      showMenuRating = items.some((item) =>
        UIExampleFactory.checkRatingItem(item),
      ); // 评分

    menuUpIfs?.setAttribute("disabled", `${!showMenuUpIfs}`); // 禁用更新期刊信息
    menuUpMeta?.setAttribute("disabled", `${!showMenuUpMeta}`); // 更新元数据
    menuRating?.setAttribute("disabled", `${!showMenuRating}`); // 评分
  }

  // 检查条目是否符合 是否为期刊
  static checkItem(item: Zotero.Item) {
    if (item && !item.isNote()) {
      if (item.isRegularItem()) {
        // not an attachment already
        if (
          Zotero.ItemTypes.getName(item.itemTypeID) == "journalArticle" || // 文献类型为期刊
          Zotero.ItemTypes.getName(item.itemTypeID) == "conferencePaper"
        ) {
          return true;
        }
      }
    }
  }

  // 检查条目元数据是否符合 英文必须有DOI
  static checkItemMeta(item: Zotero.Item) {
    const pattern = new RegExp("[\u4E00-\u9FA5]+");
    if (item && !item.isNote()) {
      if (item.isRegularItem()) {
        // not an attachment already
        const title: any = item.getField("title");
        const doi = item.getField("DOI");
        const lan = pattern.test(title) ? "zh-CN" : "en-US";
        if (
          Zotero.ItemTypes.getName(item.itemTypeID) == "journalArticle" // 文献类型必须为期刊
        ) {
          if (lan == "zh-CN") {
            //中文条目
            return title == "" ? false : true; // 题目为空时不能更新中文
          } else if (lan == "en-US") {
            //英文条目
            return doi == "" ? false : true; // 英文DOI为空时不能更新英文
          }
        }
      }
    }
  }

  // 检查条目是否符合评分条件
  static checkRatingItem(item: Zotero.Item) {
    if (item && !item.isNote()) {
      if (item.isRegularItem()) {
        return true;
      }
    }
  }

  /*
  @example
  static registerStyleSheet() {
    const styles = ztoolkit.UI.createElement(document, "link", {
      properties: {
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${config.addonRef}/content/zoteroPane.css`,
      },
    });
    document.documentElement.appendChild(styles);
    document
      .getElementById("zotero-item-pane-content")
      ?.classList.add("makeItRed");
  }
*/

  // 右键菜单
  @example
  static registerRightClickMenuItem() {
    const menuIconUpIFs = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
    const menuIconUpMeta = `chrome://${config.addonRef}/content/icons/upmeta.png`;
    // ztoolkit.Menu.register("item", {
    //   tag: "menuseparator",
    // });
    // item menuitem with icon
    // ztoolkit.Menu.register("item", {
    //   tag: "menuitem",
    //   id: "zotero-itemmenu-addontemplate-test",
    //   label: getString("menuitem-label"),
    //   commandListener: (ev) => addon.hooks.onDialogEvents("dialogExample"),
    //   icon: menuIcon,
    // });
    ztoolkit.Menu.register("item", {
      tag: "menuseparator",
    });

    // 分类右键
    ztoolkit.Menu.register("collection", {
      tag: "menuseparator",
    });
    // 分类更新条目信息
    ztoolkit.Menu.register("collection", {
      tag: "menuitem",
      id: `zotero-collectionmenu-${config.addonRef}-upifs`,
      label: getString("upifs"),
      commandListener: (ev) => KeyExampleFactory.setExtraCol(),
      icon: menuIconUpIFs,
    });
    // 分类更新元数据
    ztoolkit.Menu.register("collection", {
      tag: "menuitem",
      id: `zotero-collectionmenu-${config.addonRef}-upmeta`,
      label: getString("upmeta"),
      commandListener: (ev) => KeyExampleFactory.upMetaCol(),
      icon: menuIconUpMeta,
    });
    // 更新条目信息
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: `zotero-itemmenu-${config.addonRef}-upifs`,
      label: getString("upifs"),
      commandListener: (ev) => KeyExampleFactory.setExtraItems(),
      icon: menuIconUpIFs,
    });
    // 条目更新元数据
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: `zotero-itemmenu-${config.addonRef}-upmeta`,
      label: getString("upmeta"),
      commandListener: (ev) => KeyExampleFactory.upMetaItems(),
      icon: menuIconUpMeta,
    });
    // 评分
    ztoolkit.Menu.register("item", {
      tag: "menu",
      id: `zotero-itemmenu-${config.addonRef}-rating`,
      label: getString("rating"),
      children: [
        {
          tag: "menuitem",
          id: `zotero-itemmenu-${config.addonRef}-rating-0`,
          label: getString("rating-0"),
          commandListener: (ev) => KeyExampleFactory.setRatingItems(0),
        },
        {
          tag: "menuitem",
          id: `zotero-itemmenu-${config.addonRef}-rating-1`,
          label: getString("rating-1"),
          commandListener: (ev) => KeyExampleFactory.setRatingItems(1),
        },
        {
          tag: "menuitem",
          id: `zotero-itemmenu-${config.addonRef}-rating-2`,
          label: getString("rating-2"),
          commandListener: (ev) => KeyExampleFactory.setRatingItems(2),
        },
        {
          tag: "menuitem",
          id: `zotero-itemmenu-${config.addonRef}-rating-3`,
          label: getString("rating-3"),
          commandListener: (ev) => KeyExampleFactory.setRatingItems(3),
        },
        {
          tag: "menuitem",
          id: `zotero-itemmenu-${config.addonRef}-rating-4`,
          label: getString("rating-4"),
          commandListener: (ev) => KeyExampleFactory.setRatingItems(4),
        },
        {
          tag: "menuitem",
          id: `zotero-itemmenu-${config.addonRef}-rating-5`,
          label: getString("rating-5"),
          commandListener: (ev) => KeyExampleFactory.setRatingItems(5),
        },
      ],
    });
  }
  // @example
  // static registerRightClickMenuPopup() {
  //   ztoolkit.Menu.register(
  //     "item",
  //     {
  //       tag: "menu",
  //       label: getString("menupopup-label"),
  //       children: [
  //         {
  //           tag: "menuitem",
  //           label: getString("menuitem-submenulabel"),
  //           oncommand: "alert('Hello World! Sub Menuitem.')",
  //         },
  //       ],
  //     },
  //     "before",
  //     document.querySelector(
  //       "#zotero-itemmenu-addontemplate-test"
  //     ) as XUL.MenuItem
  //   );
  // }

  @example //Tools菜单
  static registerWindowMenuWithSeprator() {
    const menuIconUpIFs = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
    ztoolkit.Menu.register("menuTools", {
      tag: "menuseparator",
    });
    // menu->Tools menuitem
    // ztoolkit.Menu.register("menuTools", {
    //   tag: "menu",
    //   label: getString("menuitem-filemenulabel"),

    // onpopupshowing:  `Zotero.${config.addonInstance}.hooks.hideMenu()`,// 显示隐藏菜单
    // children: [
    //   {
    //     tag: "menuitem",
    //     label: getString("menuitem.submenulabel"),
    //     // oncommand: "alert('Hello World! Sub Menuitem.')",
    //     commandListener: (ev) => HelperExampleFactory.dialogAuBoldStar(),
    //   },

    // ],
    //oncommand: "alert('Hello World! File Menuitem.')",
    ztoolkit.Menu.register("menuTools", {
      tag: "menu",
      label: getString("toolbox"),
      icon: menuIconUpIFs,
      onpopupshowing: `Zotero.${config.addonInstance}.hooks.hideMenu()`, // 显示隐藏菜单

      children: [
        // Author Bold and/ or Asterisk 作者加粗加星
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-auBoldStar",
          label: getString("auBoldStar"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) => HelperExampleFactory.dialogAuProcess(),
        },
        // Clean Author Bold 清除作者加粗
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-cleanBold",
          label: getString("cleanBold"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) => HelperExampleFactory.cleanBold(),
        },
        // Clean Author Asterisk清除作者加星
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-cleanStar",
          label: getString("cleanStar"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) => HelperExampleFactory.cleanStar(),
        },
        // Clean Author Bold and Asterisk 清除作者加粗加星
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-cleanBoldStar",
          label: getString("cleanBoldStar"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) => HelperExampleFactory.cleanBoldAndStar(),
        },
        // Change Author Name to Title Case 更改作者大小写
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-chAuTitle",
          label: getString("chAuTitle"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) => HelperExampleFactory.changAuthorCase(),
        },
        // Swap Authors First and Last Name 交换作者姓和名
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-swapAuName",
          label: getString("swapAuName"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) => HelperExampleFactory.swapAuthorName(),
        },
        {
          tag: "menuseparator",
          id: "zotero-toolboxmenu-sep1",
        },
        // Change Title to Sentense Case 条目题目大小写
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-chTitleCase",
          label: getString("chTitleCase"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) => HelperExampleFactory.chanItemTitleCase(),
        },
        // Item Title Find and Replace 条目题目查找替换
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-itemTitleFindReplace",
          label: getString("itemTitleFindReplace"),
          // oncommand: "alert(KeyExampleFactory.getSelectedItems())",
          // oncommand: `ztoolkit.getGlobal('alert')(${KeyExampleFactory.getSelectedItems()})`,
          commandListener: (ev) =>
            HelperExampleFactory.dialogItemTitleProcess(),
        },
        // Change Publication Title Case 更改期刊大小写
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-chPubTitleCase",
          label: getString("chPubTitleCase"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) => HelperExampleFactory.chPubTitleCase(),
        },
        // Change Publication Title
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-chPubTitle",
          label: getString("chPubTitle"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) => HelperExampleFactory.dialogChPubTitle(),
        },
        {
          tag: "menuseparator",
          id: "zotero-toolboxmenu-sep2",
        },
        // Show Porfile Directory
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-showProfile",
          label: getString("showProfile"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) =>
            HelperExampleFactory.progressWindow(
              // @ts-ignore - Plugin instance is not typed
              `${getString("proDir")} ${Zotero.Profile.dir}`,
              "success",
            ),
        },
        // Show Data Directory
        {
          tag: "menuitem",
          id: "zotero-toolboxmenu-showData",
          label: getString("showData"),
          // oncommand: "alert('Hello World! Sub Menuitem.')",
          commandListener: (ev) =>
            HelperExampleFactory.progressWindow(
              `${getString("dataDir")} ${Zotero.DataDirectory.dir}`,
              "success",
            ),
        },
        //刷新自定义列
        // {
        //   tag: "menuitem",
        //   id: "zotero-toolboxmenu-refresh",
        //   label: '缩写',
        //   commandListener: (ev) => HelperExampleFactory.upJourAbb(),
        // },
      ],
    });
    ztoolkit.Menu.register("menuTools", {
      tag: "menuitem",
      label: getString("cleanExtra"),
      commandListener: (ev) => HelperExampleFactory.emptyExtra(),
      icon: menuIconUpIFs,
    });
  }

  // 显示隐藏工具箱中的菜单
  @example
  static hideMenu() {
    const menuboldStar = document.getElementById(
        "zotero-toolboxmenu-auBoldStar",
      ), //
      menucleanBold = document.getElementById("zotero-toolboxmenu-cleanBold"), //
      menucleanStar = document.getElementById("zotero-toolboxmenu-cleanStar"), //
      menucleanBoldStar = document.getElementById(
        "zotero-toolboxmenu-cleanBoldStar",
      ), //
      menuchAuTitle = document.getElementById("zotero-toolboxmenu-chAuTitle"), //
      menuswapAuName = document.getElementById("zotero-toolboxmenu-swapAuName"), //
      menusep1 = document.getElementById("zotero-toolboxmenu-sep1"), //
      menuchTitleCase = document.getElementById(
        "zotero-toolboxmenu-chTitleCase",
      ), //
      menuchPubTitle = document.getElementById("zotero-toolboxmenu-chPubTitle"), //
      menuchPubTitleCase = document.getElementById(
        "zotero-toolboxmenu-chPubTitleCase",
      ), //
      menuitemTitleFindReplace = document.getElementById(
        "zotero-toolboxmenu-itemTitleFindReplace",
      ), //
      menusep2 = document.getElementById("zotero-toolboxmenu-sep2"), //
      menushowProfile = document.getElementById(
        "zotero-toolboxmenu-showProfile",
      ), //
      menushowData = document.getElementById("zotero-toolboxmenu-showData"); //

    const boldStar = getPref(`bold.star`),
      cleanBold = getPref(`remove.bold`),
      cleanStar = getPref(`remove.star`),
      cleanBoldStar = getPref(`remove.bold.star`),
      chAuTitle = getPref(`chang.author.case`),
      swapAuName = getPref(`swap.author`),
      sep1 = getPref(`sep1`),
      chTitleCase = getPref(`chang.title`),
      chPubTitle = getPref(`chang.pub.title`),
      chPubTitleCase = getPref(`chang.pub.title.case`),
      itemTitleFindReplace = getPref(`item.title.find.replace`),
      sep2 = getPref(`sep2`),
      showProfile = getPref(`show.profile.dir`),
      showData = getPref(`show.data.dir`);

    // menuboldStar?.setAttribute('hidden', String(!boldStar));
    menuboldStar?.setAttribute("hidden", String(!boldStar));
    menucleanBold?.setAttribute("hidden", String(!cleanBold));
    menucleanStar?.setAttribute("hidden", String(!cleanStar));
    menucleanBoldStar?.setAttribute("hidden", String(!cleanBoldStar));
    menuchAuTitle?.setAttribute("hidden", String(!chAuTitle));
    menuswapAuName?.setAttribute("hidden", String(!swapAuName));
    menusep1?.setAttribute("hidden", String(!sep1));
    menuchTitleCase?.setAttribute("hidden", String(!chTitleCase));
    menuchPubTitle?.setAttribute("hidden", String(!chPubTitle));
    menuchPubTitleCase?.setAttribute("hidden", String(!chPubTitleCase));
    menuitemTitleFindReplace?.setAttribute(
      "hidden",
      String(!itemTitleFindReplace),
    );
    menusep2?.setAttribute("hidden", String(!sep2));
    menushowProfile?.setAttribute("hidden", String(!showProfile));
    menushowData?.setAttribute("hidden", String(!showData));

    // menuboldStar?.setAttribute('disabled', 'true');
    // (document.getElementById('zotero-toolboxmenu-auBoldStar') as HTMLElement).hidden = !boldStar;
  }
  @example
  // 添加工具栏按钮
  static registerToolbarButton() {
    const buttonId = `zotero-toolbar-${config.addonRef}-update-all`;
    if (document.getElementById(buttonId)) {
      return;
    }
    const toolbar =
      document.getElementById("zotero-items-toolbar") ||
      document.getElementById("zotero-collections-toolbar");
    if (!toolbar) {
      return;
    }
    const button = ztoolkit.UI.createElement(document, "toolbarbutton", {
      id: buttonId,
      classList: ["zotero-tb-button"],
      attributes: {
        tooltiptext: getString("toolbar-update-all"),
      },
      styles: {
        "list-style-image": `url("chrome://${config.addonRef}/content/icons/favicon@0.5x.png")`,
      },
      listeners: [
        {
          type: "command",
          listener: () => KeyExampleFactory.updateAllCol(),
        },
      ],
    });

    const searchIds = [
      "zotero-tb-search",
      "zotero-tb-search-textbox",
      "zotero-tb-searchbox",
      "quicksearch-textbox",
    ];
    const searchEl = searchIds
      .map((id) => document.getElementById(id))
      .find((el) => el);
    if (searchEl?.parentNode) {
      searchEl.parentNode.insertBefore(button, searchEl);
    } else {
      toolbar.appendChild(button);
    }
  }
  @example
  // 当更新期刊禁用时，禁用期刊是否带点选项
  static disableUppJourAbbDot() {
    const cbUpJourAbbDot = addon.data.prefs!.window.document.getElementById(
      `zotero-prefpane-${config.addonRef}-update-abbr-dot`,
    );
    const upAbbr = getPref(`update.abbr`);
    // HelperExampleFactory.progressWindow(`${upAbbr} check`, 'default');
    cbUpJourAbbDot?.setAttribute("disabled", String(!upAbbr)); // 当更新期刊禁用时，禁用期刊是否带点选项
    //
    //
  }

  @example //注册多余列
  static async registerExtraColumn() {
    const columnConfig: Record<
      string,
      {
        pref?: string;
        dataKey?: string;
        field?: string;
        value?: (item: Zotero.Item) => string;
        registeredKey?: string;
      }
    > = {
      pubConfName: {
        pref: "pub.conf.name",
        dataKey: "pubConfName",
        value: (item) => {
          const itemType = Zotero.ItemTypes.getName(item.itemTypeID);
          if (itemType === "conferencePaper") {
            return (
              (item.getField("conferenceName") as string) ||
              (item.getField("proceedingsTitle") as string) ||
              ""
            );
          }
          if (itemType === "journalArticle") {
            return (item.getField("publicationTitle") as string) || "";
          }
          return (
            (item.getField("publicationTitle") as string) ||
            (item.getField("conferenceName") as string) ||
            (item.getField("proceedingsTitle") as string) ||
            ""
          );
        },
      },
      partition: {
        pref: "partition.column",
        dataKey: "partition",
        value: (item) => {
          const partition = ztoolkit.ExtraField.getExtraField(item, "分区");
          return partition ? String(partition) : "";
        },
      },
      rating: {
        pref: "rating",
        dataKey: "rating",
        field: "评分",
        value: (item) => {
          const stored = ztoolkit.ExtraField.getExtraField(item, "评分");
          if (!stored) {
            return "";
          }
          const score = Number(stored);
          if (!Number.isFinite(score)) {
            return "";
          }
          if (score <= 0) {
            return "";
          }
          const normalized = Math.min(5, Math.max(1, score));
          return "★".repeat(normalized) + "☆".repeat(5 - normalized);
        },
      },
      ifs: {
        pref: "if.column",
        dataKey: "IF",
        field: "影响因子",
      },
      gsCitations: {
        pref: "gs.cites",
        dataKey: "GSCitations",
        field: "Google Scholar引用",
      },
      // 大学期刊分类
      swufe: {
        field: "西南财经大学",
      },
      cufe: {
        field: "中央财经大学",
      },
      uibe: {
        field: "对外经济贸易大学",
      },
      sdufe: {
        field: "山东财经大学",
      },
      xdu: {
        field: "西安电子科技大学",
      },
      swjtu: {
        field: "西南交通大学",
      },
      ruc: {
        field: "中国人民大学",
      },
      xmu: {
        field: "厦门大学",
      },
      sjtu: {
        field: "上海交通大学",
      },
      fdu: {
        field: "复旦大学",
      },
      hhu: {
        field: "河海大学",
      },
      scu: {
        field: "四川大学",
      },
      cqu: {
        field: "重庆大学",
      },
      nju: {
        field: "南京大学",
      },
      xju: {
        field: "新疆大学",
      },
      cug: {
        field: "中国地质大学",
      },
      cju: {
        field: "长江大学",
      },
      zju: {
        field: "浙江大学",
      },
      cpu: {
        field: "中国药科大学",
      },
      // 自定义数据集 custom dataset
      summary: {
        field: "总结",
      },
    };

    for (const key in columnConfig) {
      const opt = columnConfig[key];
      if (getPref(opt.pref || key)) {
        const result = await Zotero.ItemTreeManager.registerColumn({
          dataKey: opt.dataKey || key,
          label: getString(opt.dataKey || key),
          pluginID: config.addonID,
          zoteroPersist: ["width", "hidden", "sortDirection"],
          dataProvider: (item) => {
            if (opt.value) {
              return opt.value(item);
            }
            return (
              ztoolkit.ExtraField.getExtraField(item, opt.field || key) || ""
            );
          },
        });
        if (result) {
          opt.registeredKey = result;
        }
      } else {
        if (opt.registeredKey) {
          await Zotero.ItemTreeManager.unregisterColumn(opt.registeredKey);
        }
      }
    }
  }

  // @example
  // static async registerExtraColumnWithCustomCell() {
  //   await ztoolkit.ItemTree.register(
  //     // "test2",
  //     // "custom column",
  //     "JCR",
  //     "JCR",
  //     (
  //       field: string,
  //       unformatted: boolean,
  //       includeBaseMapped: boolean,
  //       item: Zotero.Item
  //     ) => {
  //       // return String(item.id);
  //       var jcr = ztoolkit.ExtraField.getExtraField(item, 'JCR分区')
  //       return String(jcr == undefined ? '' : jcr);
  //     },
  //     // {
  //     //   renderCellHook(index, data, column) {
  //     //     const span = document.createElementNS(
  //     //       "http://www.w3.org/1999/xhtml",
  //     //       "span"
  //     //     );
  //     //     span.style.background = "#0dd068";
  //     //     span.innerText = "⭐" + data;
  //     //     return span;
  //     //   },
  //     // }
  //   );
  // }
  /*
    @example
    static async registerCustomCellRenderer() {
      await ztoolkit.ItemTree.addRenderCellHook(
        "title",
        (index: number, data: string, column: any, original: Function) => {
          const span = original(index, data, column) as HTMLSpanElement;
          span.style.background = "rgb(30, 30, 30)";
          span.style.color = "rgb(156, 220, 240)";
          return span;
        }
      );
      // @ts-ignore
      // This is a private method. Make it public in toolkit.
      await ztoolkit.ItemTree.refresh();
    }

    @example
    static registerLibraryTabPanel() {
      const tabId = ztoolkit.LibraryTabPanel.register(
        getString("tabpanel-lib-tab-label"),
        (panel: XUL.Element, win: Window) => {
          const elem = ztoolkit.UI.createElement(win.document, "vbox", {
            children: [
              {
                tag: "h2",
                properties: {
                  innerText: "Hello World!",
                },
              },
              {
                tag: "div",
                properties: {
                  innerText: "This is a library tab.",
                },
              },
              {
                tag: "button",
                namespace: "html",
                properties: {
                  innerText: "Unregister",
                },
                listeners: [
                  {
                    type: "click",
                    listener: () => {
                      ztoolkit.LibraryTabPanel.unregister(tabId);
                    },
                  },
                ],
              },
            ],
          });
          panel.append(elem);
        },
        {
          targetIndex: 1,
        }
      );
    }

    @example
    static async registerReaderTabPanel() {
      const tabId = await ztoolkit.ReaderTabPanel.register(
        getString("tabpanel-reader-tab-label"),
        (
          panel: XUL.TabPanel | undefined,
          deck: XUL.Deck,
          win: Window,
          reader: _ZoteroTypes.ReaderInstance
        ) => {
          if (!panel) {
            ztoolkit.log(
              "This reader do not have right-side bar. Adding reader tab skipped."
            );
            return;
          }
          ztoolkit.log(reader);
          const elem = ztoolkit.UI.createElement(win.document, "vbox", {
            id: `${config.addonRef}-${reader._instanceID}-extra-reader-tab-div`,
            // This is important! Don't create content for multiple times
            // ignoreIfExists: true,
            removeIfExists: true,
            children: [
              {
                tag: "h2",
                properties: {
                  innerText: "Hello World!",
                },
              },
              {
                tag: "div",
                properties: {
                  innerText: "This is a reader tab.",
                },
              },
              {
                tag: "div",
                properties: {
                  innerText: `Reader: ${reader._title.slice(0, 20)}`,
                },
              },
              {
                tag: "div",
                properties: {
                  innerText: `itemID: ${reader.itemID}.`,
                },
              },
              {
                tag: "button",
                namespace: "html",
                properties: {
                  innerText: "Unregister",
                },
                listeners: [
                  {
                    type: "click",
                    listener: () => {
                      ztoolkit.ReaderTabPanel.unregister(tabId);
                    },
                  },
                ],
              },
            ],
          });
          panel.append(elem);
        },
        {
          targetIndex: 1,
        }
      );
    }
    */
}

/*
export class PromptExampleFactory {

  @example
  static registerAlertPromptExample() {
    ztoolkit.Prompt.register([
      {
        name: "Template Test",
        label: "Plugin Template",
        callback(prompt) {
          ztoolkit.getGlobal("alert")("Command triggered!");
        },
      },
    ]);
  }
}

*/
export class HelperExampleFactory {
  // 生成空格，如果是中文是无空格，英文为空格
  static whiteSpace() {
    const lanUI = Zotero.Prefs.get("intl.locale.requested"); // 得到当前Zotero界面语言
    let whiteSpace = " ";
    if (lanUI == "zh-CN") {
      whiteSpace = "";
    }
    return whiteSpace;
  }

  static async emptyExtra() {
    const items: any = KeyExampleFactory.getSelectedItems();
    if (items.length == 0) {
      var alertInfo = getString("zeroItem");
      this.progressWindow(alertInfo, "fail");
      return;
    } else {
      const truthBeTold = window.confirm(getString("cleanExtraAlt"));
      if (truthBeTold) {
        for (const item of items) {
          if (item.isRegularItem() && !(item instanceof Zotero.Collection)) {
            try {
              item.setField("extra", "");
              item.save();
            } catch (error) {
              Zotero.debug("Extra清空失败！");
            }
          }
        }
        var alertInfo = getString("cleanExtraSuc");
        HelperExampleFactory.progressWindow(alertInfo, "success");
      }
    }
  }

  // 更改期刊名称
  // static async chPubTitle(searchText: string, repText: string) {
  //   new ztoolkit.ProgressWindow(config.addonName)
  //     .createLine({
  //       text: 'find:' + searchText + 'replace:' + repText,
  //       type: "success",
  //       progress: 100,
  //     })
  //     .show();
  // }

  // 更改期刊名称
  static async chPubTitle(oldTitle: string, newTitle: string) {
    // var oldTitle = document.getElementById('id-updateifs-old-title-textbox').value.trim();
    // var newTitle = document.getElementById('id-updateifs-new-title-textbox').value.trim();
    // 如果新或老题目为空则提示
    if (oldTitle == "" || newTitle == "") {
      var alertInfo = getString("pubTitleEmpty");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
    } else {
      const items = KeyExampleFactory.getSelectedItems();
      let n = 0;
      let itemOldTitle = "";
      if (items.length == 0) {
        var alertInfo = getString("zeroItem");
        this.progressWindow(alertInfo, "fail");
        return;
      } else {
        for (const item of items) {
          itemOldTitle = (item.getField("publicationTitle") as any).trim(); //原题目
          if (oldTitle == itemOldTitle) {
            //如果和输入的相等则替换
            item.setField("publicationTitle", newTitle);
            await item.saveTx();
            n++;
          }
        }
        const statusInfo = n == 0 ? "fail" : "success";
        const whiteSpace = HelperExampleFactory.whiteSpace();
        alertInfo = n + whiteSpace + getString("successPubTitle");
        HelperExampleFactory.progressWindow(alertInfo, statusInfo);
      }
    }
  }

  // 更改期刊大小写
  static async chPubTitleCase() {
    const items: any = KeyExampleFactory.getSelectedItems();
    const whiteSpace = HelperExampleFactory.whiteSpace();
    let n = 0;
    let newPubTitle = "";
    if (items.length == 0) {
      var alertInfo = getString("zeroItem");
      this.progressWindow(alertInfo, "fail");
      return;
    } else {
      HelperExampleFactory.chanItemTitleCaseDo(items);
      for (const item of items) {
        const oldPubTitle = item.getField("publicationTitle").trim(); //原题目
        newPubTitle = HelperExampleFactory.titleCase(oldPubTitle) //转为词首字母大写
          .replace(" And ", " and ") // 替换And
          .replace(" For ", " for ") // 替换For
          .replace(" In ", " in ") // 替换In
          .replace(" Of ", " of ") // 替换Of
          .replace("Plos One", "PLOS ONE")
          .replace("Plos", "PLOS")
          .replace("Msystems", "mSystems")
          .replace("Lwt", "LWT")
          .replace("LWT-food", "LWT-Food")
          .replace("LWT - food", "LWT - Food")
          .replace("Ieee", "IEEE")
          .replace("Gida", "GIDA")
          .replace("Pnas", "PNAS")
          .replace("Iscience", "iScience");
        item.setField("publicationTitle", newPubTitle);
        await item.saveTx();
        n++;
      }
      const statusInfo = n == 0 ? "fail" : "success";
      // var itemNo = n > 1 ? 'success.pub.title.mul' : 'success.pub.title.sig';
      alertInfo = n + whiteSpace + getString("successPubTitleCase");
      this.progressWindow(alertInfo, statusInfo);
    }
  }

  // 将题目改为句首字母大写
  @example
  static async chanItemTitleCase() {
    const items: any = KeyExampleFactory.getSelectedItems();
    const whiteSpace = HelperExampleFactory.whiteSpace();
    let n = 0;

    if (items.length == 0) {
      var alertInfo = getString("zeroItem");
      this.progressWindow(alertInfo, "fail");
      return;
    } else {
      n = await HelperExampleFactory.chanItemTitleCaseDo(items);
      // for (let item of items) {

      //   var title = item.getField('title');
      //   if (HelperExampleFactory.detectUpCase(title)) {//如果条目题目全部为大写，转换并提醒
      //     title = HelperExampleFactory.titleCase(title); // 转换为单词首字母大写
      //     alertInfo = getString('allUpcase');
      //     HelperExampleFactory.progressWindow(alertInfo, 'infomation');
      //   }

      //   var new_title = title.replace(/\b([A-Z][a-z0-9]+|A)\b/g, function (x: any) { return x.toLowerCase(); });
      //   new_title = new_title.replace(/(^|\?\s*)[a-z]/, function (x: any) { return x.toUpperCase(); }).
      //     replace('china', 'China'). // 替换china  代码来源于fredericky123，感谢。
      //     replace('chinese', 'Chinese'). // 替换chinese
      //     replace('america', 'America'). // 替换america
      //     replace('english', 'English'). // 替换english
      //     replace('england', 'England'). // 替换england
      //     replace('3d', '3D').
      //     replace('india', 'India'). // 替换india
      //     replace('dpph', 'DPPH'). // 专有名词
      //     replace('abts', 'ABTS'). // 专有名词
      //     //20220510 增加冒号后面为大写字母
      //     // https://stackoverflow.com/questions/72180052/regexp-match-and-replace-to-its-uppercase-in-javascript#72180194
      //     replace(/：|:\s*\w/, (fullMatch: string) => fullMatch.toUpperCase()); //匹配冒号后面的空格及一个字母，并转为大写
      //   n++;
      //   item.setField('title', new_title);
      //   await item.saveTx();
      // }
    }
    const statusInfo = n == 0 ? "fail" : "success";
    alertInfo = n + whiteSpace + getString("successItemTitleCase");
    this.progressWindow(alertInfo, statusInfo);
  }

  // 将题目改为句首字母大写 具体执行函数
  @example
  static async chanItemTitleCaseDo(items: any) {
    let n = 0;
    // var whiteSpace = HelperExampleFactory.whiteSpace();

    for (const item of items) {
      let title = item.getField("title");
      if (HelperExampleFactory.detectUpCase(title)) {
        //如果条目题目全部为大写，转换并提醒
        title = HelperExampleFactory.titleCase(title); // 转换为单词首字母大写
        const alertInfo = getString("allUpcase");
        HelperExampleFactory.progressWindow(alertInfo, "infomation");
      }

      // var new_title = title.replace(/\b([A-Z][a-z0-9]+|A)\b/g, function (x: any) { return x.toLowerCase(); });

      // new_title = new_title.replace(/(^|\?\s*)[a-z]/, function (x: any) { return x.toUpperCase(); }).
      const new_title = Zotero.Utilities.sentenceCase(title) // 调用官方接口，转为句首字母大写
        .replace("china", "China") // 替换china  代码来源于fredericky123，感谢。
        .replace("chinese", "Chinese") // 替换chinese
        .replace("america", "America") // 替换america
        .replace("english", "English") // 替换english
        .replace("england", "England") // 替换england
        .replace("3d", "3D")
        .replace("india", "India") // 替换india
        .replace("dpph", "DPPH") // 专有名词
        .replace("abts", "ABTS") // 专有名词
        .replace("h2", "H2") // 专有名词
        // replace(' ni', ' Ni'). // 专有名词
        //20220510 增加冒号后面为大写字母
        // https://stackoverflow.com/questions/72180052/regexp-match-and-replace-to-its-uppercase-in-javascript#72180194
        .replace(/：|:\s*\w/, (fullMatch: string) => fullMatch.toUpperCase()); //匹配冒号后面的空格及一个字母，并转为大写
      n++;
      item.setField("title", new_title);
      await item.saveTx();
    }
    // var statusInfo = n == 0 ? 'fail' : 'success';
    // alertInfo = n + whiteSpace + getString('successItemTitleCase');
    // this.progressWindow(alertInfo, statusInfo);
    return n;
  }

  // 检查句子是否为全部大写
  static detectUpCase(word: string) {
    const arr_is_uppercase: number[] = [];
    for (const char of word) {
      if (char.charCodeAt(0) < 97) {
        arr_is_uppercase.push(1); // 是大写就加入 1
      } else {
        arr_is_uppercase.push(0); // 是小写就加入 0
      }
    }
    const uppercase_sum = arr_is_uppercase.reduce((x, y) => x + y);
    if (
      uppercase_sum === word.length // 全部为大写
    ) {
      return true;
    } else {
      return false;
    }
  }

  // 更新期刊缩写
  static async upJourAbb(item: Zotero.Item) {
    //
    // var items = ZoteroPane.getSelectedItems();
    // var item = items[0];

    // 得到期刊缩写设置
    // getPref(`add.update`);

    const upJourAbb = getPref(`update.abbr`);
    const dotAbb = getPref(`update.abbr.dot`);
    const enAbb = getPref(`en.abbr`);
    const chAbb = getPref(`ch.abbr`);

    const pattern = new RegExp("[\u4E00-\u9FA5]+");
    const title = String(item.getField("title"));
    const lan = pattern.test(title) ? "zh-CN" : "en-US"; // 得到条目语言
    // lan == 'en-US'英文条目
    // lan == 'zh-CN'中文条目

    // var lanItem = item.getField('language');

    // var enItem = /en|English/.test(lanItem as any)
    // var chItem = /ch|zh|中文|CN/.test(lanItem as any)

    const pubT = item.getField("publicationTitle");
    if (upJourAbb) {
      try {
        var jourAbbWithDot = await HelperExampleFactory.getJourAbb(pubT); // 得到带点和不带点的缩写
      } catch (e) {
        Zotero.debug("获取期刊缩写失败");
      }

      if (jourAbbWithDot == null) {
        // 得到带点和不带点的缩写, 尝试& 替换为 and
        try {
          var jourAbbWithDot = await HelperExampleFactory.getJourAbb(
            (pubT as any).replace("&", "and"),
          ); // 得到带点和不带点的缩写
        } catch (e) {
          Zotero.debug("获取期刊缩写失败");
        }
      }

      if (jourAbbWithDot == null) {
        // 自定义的期刊缩写
        try {
          var jourAbbWithDot = getAbbEx(pubT as any); // 得到带点和不带点的缩写
        } catch (e) {
          Zotero.debug("获取自定义期刊缩写失败");
        }
      }

      if (jourAbbWithDot == null) {
        // 得到带点和不带点的缩写, 尝试删除the空格
        try {
          var jourAbbWithDot = await HelperExampleFactory.getJourAbb(
            (pubT as any).replace(/the\s/i, ""),
          ); // 得到带点和不带点的缩写
        } catch (e) {
          Zotero.debug("获取期刊缩写失败");
        }
      }

      if (jourAbbWithDot != null) {
        try {
          const jourAbb = dotAbb
            ? jourAbbWithDot
            : jourAbbWithDot.replace(/\./g, ""); // 替换带点缩写中的点

          let abb = HelperExampleFactory.titleCase(jourAbb); //改为词首字母大写
          abb = abb
            .replace("Ieee", "IEEE") //替换IEEE
            .replace("Acs", "ACS") //替换ACS
            .replace("Aip", "AIP") //替换AIP
            .replace("Apl", "APL") //替换APL
            .replace("Avs", "AVS") //替换AVS
            .replace("Bmc", "BMC") //替换AVS
            .replace("Iet", "IET") //替换IET
            .replace("Rsc", "RSC") //替换RSC
            .replace("U S A", "USA") //删除空格
            .replace("U. S. A.", "U.S.A."); //删除空格
          item.setField("journalAbbreviation", abb);
        } catch (e) {
          return;
        }
        // 英文如果找不到缩写是否用全称代替
      } else {
        if (enAbb && lan == "en-US") {
          item.setField("journalAbbreviation", pubT);
          // 中文如果找不到缩 写是否用全称代替
        } else if (chAbb && lan == "zh-CN") {
          item.setField("journalAbbreviation", pubT);
        }
      }
    }
    //return jourAbbs
    item.saveTx();
  }

  // 得到期刊缩写 带点缩写 代码From @l0o0,感谢小林。
  static async getJourAbb(pubT: any) {
    // var pubT = (item.getField('publicationTitle') as any).replace('&', 'and');
    const resp = await Zotero.HTTP.request(
      "GET",
      `http://121.196.229.180:8080/v1/journals/abbreviation/${encodeURI(pubT)}`,
      { headers: { pluginID: "redfrog@redleafnew.me" } },
    );
    try {
      if (JSON.parse(resp.responseText)["data"] != null) {
        return JSON.parse(resp.responseText)["data"]["abb_with_dot"];
      } else {
        return null;
      }
    } catch (e) {
      return;
    }
  }

  // 作者处理函数 加粗加星
  @example
  static async auProcess(author: string, process: string) {
    const oldName = HelperExampleFactory.newNames(author, process)![0];
    const newFirstName = HelperExampleFactory.newNames(author, process)![1];
    const newLastName = HelperExampleFactory.newNames(author, process)![2];
    const newFieldMode = HelperExampleFactory.newNames(author, process)![3]; // 0: two-field, 1: one-field (with empty first name)
    const mergeedName = HelperExampleFactory.newNames(author, process)![4];
    const mergeedNameNew = HelperExampleFactory.newNames(author, process)![5];

    let rn = 0; //计数替换条目个数
    //await Zotero.DB.executeTransaction(async function () {

    const items = KeyExampleFactory.getSelectedItems();
    if (items.length == 0) {
      // 如果没有选中条目则提示，中止
      alertInfo = getString("zeroItem");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
    } else {
      for (const item of items) {
        const creators = item.getCreators();
        const newCreators: any[] = [];
        for (const creator of creators) {
          if (`${creator.firstName} ${creator.lastName}`.trim() == oldName) {
            (creator as any).firstName = newFirstName;
            (creator.lastName as any) = newLastName;
            (creator.fieldMode as any) = newFieldMode;
            rn++;
          }

          if (
            `${HelperExampleFactory.replaceBoldStar(creator.lastName as any)}`.trim() ==
            mergeedName
          ) {
            // 针对已经合并姓名的
            creator.firstName = "";
            (creator.lastName as any) = mergeedNameNew;
            (creator.fieldMode as any) = newFieldMode;
            rn++;
          }
          if (
            `${HelperExampleFactory.replaceBoldStar(creator.firstName as any)} ${HelperExampleFactory.replaceBoldStar(creator.lastName as any)}`.trim() ==
            oldName
          ) {
            (creator.firstName as any) = newFirstName;
            (creator.lastName as any) = newLastName;
            (creator.fieldMode as any) = newFieldMode;
            rn++;
          }
          newCreators.push(creator);
        }
        item.setCreators(newCreators);
        await item.save();
      }

      const whiteSpace = HelperExampleFactory.whiteSpace();
      const statusInfo = rn > 0 ? "success" : "fail";
      var alertInfo = `${rn} ${whiteSpace} ${getString("authorChanged")}`;
      HelperExampleFactory.progressWindow(alertInfo, statusInfo);
    }
  }

  @example
  // 返回新的名字用以替换
  static newNames(authorName: any, boldStar: any) {
    const newName: Array<string | number> = [];
    var splitName = "";
    let oldName = "";
    let newFirstName = "";
    let newLastName = "";
    // var reg = /[一-龟]/; // 匹配所有汉字
    const reg = new RegExp("[\u4E00-\u9FA5]+"); // 匹配所有汉字
    let mergeedName = "";
    let mergeedNameNew = "";
    let alertInfo = "";

    if (authorName == "") {
      // 如果作者为空时提示
      alertInfo = getString("authorEmpty");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
    } else if (!/\s/.test(authorName)) {
      //检测输入的姓名中是否有空格,无空格提示
      alertInfo = getString("authorNoSpace");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
    } else {
      var splitName: string = authorName.split(/\s/); // 用空格分为名和姓
      const firstName = splitName[1];
      const lastName = splitName[0];
      oldName = firstName + " " + lastName;
      Zotero.debug(reg.test(authorName) + ": ture 为中文");
      // 检测姓名是否为中文
      if (reg.test(authorName)) {
        // 为真时匹配到中文
        var newFieldMode = 1; // 1中文时为合并
        mergeedName = authorName.replace(/\s/, ""); // 中文姓名删除空格得到合并的姓名
      } else {
        newFieldMode = 0; // 0为拆分姓名，英文
        mergeedName = oldName; // 英文姓名与原姓名相同
      }

      switch (boldStar) {
        case "boldStar": // 加粗加星
          mergeedNameNew = "<b>" + mergeedName + "*</b>";
          newFirstName = "<b>" + firstName + "*</b>";
          newLastName = "<b>" + lastName + "</b>";
          if (reg.test(authorName)) {
            // 中文姓名
            newFirstName = "";
            newLastName = "<b>" + lastName + firstName + "*</b>";
          }
          break;
        case "bold": // 仅加粗
          mergeedNameNew = "<b>" + mergeedName + "</b>";
          newFirstName = "<b>" + firstName + "</b>";
          newLastName = "<b>" + lastName + "</b>";
          if (reg.test(authorName)) {
            // 中文姓名
            newFirstName = "";
            newLastName = "<b>" + lastName + firstName + "</b>";
          }
          break;
        case "star": // 加粗加星
          mergeedNameNew = mergeedName + "*";
          newFirstName = firstName + "*";
          newLastName = lastName;
          if (reg.test(authorName)) {
            // 中文姓名
            newFirstName = "";
            newLastName = lastName + firstName + "*";
          }
          break;
        case "n":
          break;
      }
      newName.push(
        oldName,
        newFirstName,
        newLastName,
        newFieldMode,
        mergeedName,
        mergeedNameNew,
      );
      return newName;
    }
  }
  @example
  //删除作者姓名中的粗体和星号标识
  static replaceBoldStar(auName: string) {
    return auName.replace(/<b>/g, "").replace(/<\/b>/g, "").replace(/\*/g, "");
  }

  // 清除加粗
  static async cleanBold() {
    let rn = 0;
    const items = KeyExampleFactory.getSelectedItems();
    if (items.length == 0) {
      // 如果没有选中条目则提示，中止
      alertInfo = getString("zeroItem");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
      return;
    }
    for (const item of items) {
      const creators = item.getCreators();
      const newCreators: any[] = [];

      for (const creator of creators) {
        if (
          /<b>/.test(creator.firstName as any) ||
          /<b>/.test(creator.lastName as any)
        ) {
          // 是否包含<b>

          creator.firstName = creator
            .firstName!.replace(/<b>/g, "")
            .replace(/<\/b>/g, "");
          creator.lastName = creator
            .lastName!.replace(/<b>/g, "")
            .replace(/<\/b>/g, "");
          rn++;
        }
        newCreators.push(creator);
      }
      item.setCreators(newCreators);

      await item.saveTx();
    }
    const whiteSpace = HelperExampleFactory.whiteSpace();
    const statusInfo = rn > 0 ? "success" : "fail";
    var alertInfo = `${rn} ${whiteSpace} ${getString("authorChanged")}`;
    HelperExampleFactory.progressWindow(alertInfo, statusInfo);
  }

  // 清除加星
  static async cleanStar() {
    let rn = 0;
    const items = KeyExampleFactory.getSelectedItems();
    if (items.length == 0) {
      // 如果没有选中条目则提示，中止
      alertInfo = getString("zeroItem");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
      return;
    }
    for (const item of items) {
      const creators = item.getCreators();
      const newCreators: any[] = [];

      for (const creator of creators) {
        if (
          /\*/.test(creator.firstName as any) ||
          /\*/.test(creator.lastName as any)
        ) {
          creator.firstName = creator.firstName!.replace(/\*/g, "");
          creator.lastName = creator.lastName!.replace(/\*/g, "");
          rn++;
        }
        newCreators.push(creator);
      }
      item.setCreators(newCreators);

      // await item.save();
      await item.saveTx();
    }
    const whiteSpace = HelperExampleFactory.whiteSpace();
    const statusInfo = rn > 0 ? "success" : "fail";
    var alertInfo = `${rn} ${whiteSpace} ${getString("authorChanged")}`;
    HelperExampleFactory.progressWindow(alertInfo, statusInfo);
  }

  // 清除加粗加星
  static async cleanBoldAndStar() {
    let rn = 0;
    const items = KeyExampleFactory.getSelectedItems();
    if (items.length == 0) {
      // 如果没有选中条目则提示，中止
      alertInfo = getString("zeroItem");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
      return;
    }
    for (const item of items) {
      const creators = item.getCreators();
      const newCreators: any[] = [];

      for (const creator of creators) {
        if (
          /<b>/.test(creator.firstName as any) ||
          /<b>/.test(creator.lastName as any) ||
          /\*/.test(creator.firstName as any) ||
          /\*/.test(creator.lastName as any)
        ) {
          // 是否包含<b>

          creator.firstName = creator
            .firstName!.replace(/<b>/g, "")
            .replace(/<\/b>/g, "")
            .replace(/\*/g, "");
          creator.lastName = creator
            .lastName!.replace(/<b>/g, "")
            .replace(/<\/b>/g, "")
            .replace(/\*/g, "");

          rn++;
        }
        newCreators.push(creator);
      }
      item.setCreators(newCreators);

      await item.saveTx();
    }
    const whiteSpace = HelperExampleFactory.whiteSpace();
    const statusInfo = rn > 0 ? "success" : "fail";
    var alertInfo = `${rn} ${whiteSpace} ${getString("authorChanged")}`;
    HelperExampleFactory.progressWindow(alertInfo, statusInfo);
  }

  @example
  // 交换作者姓和名
  static async swapAuthorName() {
    let rn = 0; //计数替换条目个数
    //var newFieldMode = 0; // 0: two-field, 1: one-field (with empty first name)
    const items = KeyExampleFactory.getSelectedItems();
    if (items.length == 0) {
      // 如果没有选中条目则提示，中止
      alertInfo = getString("zeroItem");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
      return;
    } else {
      for (const item of items) {
        const creators = item.getCreators();
        const newCreators: any[] = [];
        for (const creator of creators) {
          // if (`${creator.firstName} ${creator.lastName}`.trim() == oldName) {
          const firstName = creator.firstName;
          const lastName = creator.lastName;

          creator.firstName = lastName;
          creator.lastName = firstName;
          newCreators.push(creator);
        }
        item.setCreators(newCreators);
        rn++;
        await item.save();
      }
    }
    const whiteSpace = HelperExampleFactory.whiteSpace();
    const statusInfo = rn > 0 ? "success" : "fail";
    var alertInfo = rn + whiteSpace + getString("itemAuSwapped");
    HelperExampleFactory.progressWindow(alertInfo, statusInfo);
  }

  // 更改作者名称大小写
  @example
  static async changAuthorCase() {
    let rn = 0; //计数替换条目个数
    // var newFieldMode = 0; // 0: two-field, 1: one-field (with empty first name)
    //await Zotero.DB.executeTransaction(async function () {
    const items = KeyExampleFactory.getSelectedItems();
    if (items.length == 0) {
      // 如果没有选中条目则提示，中止
      alertInfo = getString("zeroItem");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
      return;
    } else {
      for (const item of items) {
        const creators = item.getCreators();
        const newCreators: any[] = [];
        for (const creator of creators) {
          creator.firstName = HelperExampleFactory.titleCase(
            creator.firstName!.trim(),
          );
          creator.lastName = HelperExampleFactory.titleCase(
            creator.lastName!.trim(),
          );
          newCreators.push(creator);
        }
        item.setCreators(newCreators);
        await item.save();
        rn++;
      }
    }
    const whiteSpace = HelperExampleFactory.whiteSpace();
    const statusInfo = rn > 0 ? "success" : "fail";
    var alertInfo = `${rn} ${whiteSpace} ${getString("itemAuthorChanged")}`;
    HelperExampleFactory.progressWindow(alertInfo, statusInfo);
  }

  // 将单词转为首字母大写
  static titleCase(str: string) {
    const newStr = str.split(" ");
    for (let i = 0; i < newStr.length; i++) {
      newStr[i] =
        newStr[i].slice(0, 1).toUpperCase() + newStr[i].slice(1).toLowerCase();
    }
    return newStr.join(" ");
  }

  // 条目题目处理函数 条目查找替换
  @example
  static async itemTitleFindRep(oldTitle: string, newTitle: string) {
    // 如果新或老题目为空则提示
    if (oldTitle == "" || newTitle == "") {
      var alertInfo = getString("titleEmpty");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
    } else if (oldTitle == newTitle) {
      alertInfo = getString("findRepSame");
      HelperExampleFactory.progressWindow(alertInfo, "fail");
    } else {
      let n = 0;
      let itemOldTitle = ""; // 原题目
      let replaced_title = ""; // 新题目
      const items = KeyExampleFactory.getSelectedItems();
      if (items.length == 0) {
        // 如果没有选中条目则提示，中止
        alertInfo = getString("zeroItem");
        HelperExampleFactory.progressWindow(alertInfo, "fail");
        return;
      } else {
        for (const item of items) {
          itemOldTitle = (item.getField("title") as any).trim(); //原题目
          if (itemOldTitle.indexOf(oldTitle) != -1) {
            //如果包含原字符
            replaced_title = itemOldTitle.replace(oldTitle, newTitle);
            item.setField("title", replaced_title);
            await item.saveTx();
            n++;
          }
        }
      }
      const whiteSpace = HelperExampleFactory.whiteSpace();
      const statusInfo = n > 0 ? "success" : "fail";
      var alertInfo = `${n} ${whiteSpace} ${getString("itemTitleFindRepSuc")}`;
      HelperExampleFactory.progressWindow(alertInfo, statusInfo);
    }
  }

  @example
  // 作者处理对话框{
  static async dialogAuProcess() {
    const padding = "1px 1px 1px 1px";
    const margin = "1px 1px 1px 30px";
    const widthSmall = "60px";
    const widthMiddle = "90px";
    const widthLarge = "125px";
    const dialog = new ztoolkit.Dialog(5, 3)
      .addCell(
        0,
        0,
        {
          tag: "h4",
          styles: {
            height: "10px",
            margin: margin,
            // border: border,
            padding: padding,
          },
          properties: { innerHTML: getString("authorProcess") },
        },
        false,
      )
      .addCell(
        1,
        0,
        {
          tag: "p",
          styles: {
            width: "460px",
            padding: padding,
            margin: margin,
            // border: border,
          },
          properties: { innerHTML: getString("authorProcessName") },
        },
        false,
      )
      .addCell(
        2,
        0,
        {
          tag: "input",
          id: "dialog-input4",
          styles: {
            width: "300px",
            margin: "10px 1px 1px 70px",
            // border: border,
          },
        },
        false,
      )
      .addCell(
        3,
        0,
        {
          //作者加粗对话框
          tag: "button",
          namespace: "html",
          styles: {
            padding: padding,
            margin: "1px 1px 1px 40px",
            // border: border,
          },
          attributes: {
            type: "button",
          },
          listeners: [
            {
              type: "click",
              listener: (e: Event) => {
                const author = (
                  dialog.window.document.getElementById(
                    "dialog-input4",
                  ) as HTMLInputElement
                ).value;
                this.auProcess(author, "bold");
              },
            },
          ],
          children: [
            {
              tag: "div",
              styles: {
                width: widthSmall,
                padding: padding,
              },
              properties: {
                innerHTML: getString("boldLabel"),
              },
            },
          ],
        },
        false,
      )
      .addCell(
        3,
        1,
        {
          //作者加星对话框
          tag: "button",
          styles: {
            padding: padding,
            margin: margin,
          },
          namespace: "html",
          attributes: {
            type: "button",
          },
          listeners: [
            {
              type: "click",
              listener: (e: Event) => {
                const author = (
                  dialog.window.document.getElementById(
                    "dialog-input4",
                  ) as HTMLInputElement
                ).value;
                this.auProcess(author, "star");
              },
            },
          ],
          children: [
            {
              tag: "div",
              styles: {
                width: widthMiddle,
                padding: padding,
              },
              properties: {
                innerHTML: getString("starLabel"),
              },
            },
          ],
        },
        false,
      )
      .addCell(
        3,
        2,
        {
          //作者加粗加星对话框
          tag: "button",
          styles: {
            padding: padding,
            margin: margin,
            // border: border,
          },
          namespace: "html",
          attributes: {
            type: "button",
          },
          listeners: [
            {
              type: "click",
              listener: (e: Event) => {
                const author = (
                  dialog.window.document.getElementById(
                    "dialog-input4",
                  ) as HTMLInputElement
                ).value;
                this.auProcess(author, "boldStar");
              },
            },
          ],
          children: [
            {
              tag: "div",
              styles: {
                width: widthLarge,
                padding: padding,
              },
              properties: {
                innerHTML: getString("boldStarLabel"),
              },
            },
          ],
        },
        false,
      )
      .addCell(
        4,
        0,
        {
          //作者去粗
          tag: "button",
          styles: {
            padding: padding,
            margin: "1px 1px 1px 40px",
            // border: border,
          },
          namespace: "html",
          attributes: {
            type: "button",
          },
          listeners: [
            {
              type: "click",
              listener: (e: Event) => {
                // var author = (dialog.window.document.getElementById('dialog-input4') as HTMLInputElement).value;
                HelperExampleFactory.cleanBold();
              },
            },
          ],
          children: [
            {
              tag: "div",
              styles: {
                width: widthSmall,
                padding: padding,
                // margin: '20px 20px 20px 20px',
              },
              properties: {
                innerHTML: getString("cleanBoldLabel"),
              },
            },
          ],
        },
        false,
      )
      .addCell(
        4,
        1,
        {
          //作者去星
          tag: "button",
          styles: {
            padding: padding,
            margin: margin,
            // border: border,
          },
          namespace: "html",
          attributes: {
            type: "button",
          },
          listeners: [
            {
              type: "click",
              listener: (e: Event) => {
                // var author = (dialog.window.document.getElementById('dialog-input4') as HTMLInputElement).value;
                HelperExampleFactory.cleanStar();
              },
            },
          ],
          children: [
            {
              tag: "div",
              styles: {
                width: widthMiddle,
                padding: padding,
              },
              properties: {
                innerHTML: getString("cleanStarLabel"),
              },
            },
          ],
        },
        false,
      )
      .addCell(
        4,
        2,
        {
          //作者去粗去星对话框
          tag: "button",
          styles: {
            padding: padding,
            margin: margin,
            // border: border,
          },
          namespace: "html",
          attributes: {
            type: "button",
          },
          listeners: [
            {
              type: "click",
              listener: (e: Event) => {
                // var author = (dialog.window.document.getElementById('dialog-input4') as HTMLInputElement).value;
                HelperExampleFactory.cleanBoldAndStar();
              },
            },
          ],
          children: [
            {
              tag: "div",
              styles: {
                width: widthLarge,
                padding: padding,
              },
              properties: {
                innerHTML: getString("cleanBoldStarLabel"),
              },
            },
          ],
        },
        false,
      )
      // .addButton(getString('boldLabel'), "boldButton", {
      //   noClose: true,
      //   callback: (e) => {
      //     var text = (dialog.window.document.getElementById('dialog-input4') as HTMLInputElement).value;
      //     new ztoolkit.ProgressWindow(config.addonName)
      //       .createLine({
      //         text: text,
      //         type: "success",
      //         progress: 100,
      //       })
      //       .show();

      //   },
      // })
      // .setDialogData(dialogData)
      .open(getString("authorProcessDiaTitle"), {
        width: 500,
        height: 250,
        centerscreen: true,
        // fitContent: true,
      });
  }

  @example
  // 条目题目查找替换
  static async dialogItemTitleProcess() {
    const padding = "1px 1px 1px 1px";
    const dialog = new ztoolkit.Dialog(5, 2)
      .addCell(
        0,
        0,
        {
          tag: "h4",
          styles: {
            height: "10px",
            margin: "1px 1px 1px 30px",
            // border: border,
            padding: padding,
          },
          properties: { innerHTML: getString("itemTitleFindReplaceLabel") },
        },
        false,
      )
      .addCell(
        1,
        0,
        {
          tag: "p",
          styles: {
            width: "460px",
            padding: padding,
            margin: "1px 1px 1px 30px",
            // border: border,
          },
          properties: { innerHTML: getString("titleSearchReplaceLabel") },
        },
        false,
      )
      .addCell(
        2,
        0,
        {
          tag: "p",
          styles: {
            width: "100px",
            padding: padding,
            margin: "5px 1px 1px 30px",
            // border: border,
          },
          properties: { innerHTML: getString("titleSearLabel") },
        },
        false,
      )
      .addCell(
        2,
        1,
        {
          tag: "input",
          id: "item-title-search-input",
          styles: {
            width: "300px",
            margin: "10px 1px 1px 8px",
            // border: border,
          },
        },
        false,
      )
      .addCell(
        3,
        0,
        {
          tag: "p",
          styles: {
            width: "100px",
            padding: padding,
            margin: "5px 1px 1px 30px",
            // border: border,
          },
          properties: { innerHTML: getString("titleReplaceLabel") },
        },
        false,
      )
      .addCell(
        3,
        1,
        {
          tag: "input",
          id: "item-title-replace-input",
          styles: {
            width: "300px",
            margin: "10px 1px 1px 8px",
            // border: border,
          },
        },
        false,
      )
      .addCell(
        4,
        0,
        {
          tag: "button",
          styles: {
            padding: padding,
            margin: "1px 1px 1px 200px",
            // border: border,
          },
          namespace: "html",
          attributes: {
            type: "button",
          },
          listeners: [
            {
              type: "click",
              listener: (e: Event) => {
                const searchText = (
                  dialog.window.document.getElementById(
                    "item-title-search-input",
                  ) as HTMLInputElement
                ).value;
                const repText = (
                  dialog.window.document.getElementById(
                    "item-title-replace-input",
                  ) as HTMLInputElement
                ).value;
                this.itemTitleFindRep(searchText, repText);
              },
            },
          ],
          children: [
            {
              tag: "div",
              styles: {
                width: "100px",
                padding: padding,
              },
              properties: {
                innerHTML: getString("titleReplaceButton"),
              },
            },
          ],
        },
        false,
      )
      .open(getString("titleSearchReplaceWin"), {
        width: 510,
        height: 250,
        centerscreen: true,
        // fitContent: true,
      });
  }

  @example
  // 更改期刊题目对话框
  static async dialogChPubTitle() {
    const padding = "1px 1px 1px 1px";
    const dialog = new ztoolkit.Dialog(7, 1)
      .addCell(
        0,
        0,
        {
          tag: "h4",
          styles: {
            height: "10px",
            margin: "1px 1px 1px 30px",
            // border: border,
            padding: padding,
          },
          properties: { innerHTML: getString("change-pub-title") },
        },
        false,
      )
      .addCell(
        1,
        0,
        {
          tag: "p",
          styles: {
            width: "460px",
            padding: padding,
            margin: "1px 1px 1px 30px",
            // border: border,
          },
          properties: { innerHTML: getString("change-pub-title-desc") },
        },
        false,
      )
      .addCell(
        2,
        0,
        {
          tag: "p",
          styles: {
            width: "400px",
            padding: padding,
            margin: "15px 1px 1px 80px",
            // border: border,
          },
          properties: { innerHTML: getString("old-pub-title") },
        },
        false,
      )
      .addCell(
        3,
        0,
        {
          tag: "input",
          id: "change-pub-title-old",
          styles: {
            width: "300px",
            margin: "10px 1px 1px 80px",
            // border: border,
          },
        },
        false,
      )
      .addCell(
        4,
        0,
        {
          tag: "p",
          styles: {
            width: "400px",
            padding: padding,
            margin: "10px 1px 1px 80px",
            // border: border,
          },
          properties: { innerHTML: getString("new-pub-title") },
        },
        false,
      )
      .addCell(
        5,
        0,
        {
          tag: "input",
          id: "change-pub-title-new",
          styles: {
            width: "300px",
            margin: "10px 1px 1px 80px",
            // border: border,
          },
        },
        false,
      )
      .addCell(
        6,
        0,
        {
          tag: "button",
          styles: {
            padding: padding,
            margin: "15px 1px 1px 150px",
            // border: border,
          },
          namespace: "html",
          attributes: {
            type: "button",
          },
          listeners: [
            {
              type: "click",
              listener: (e: Event) => {
                const searchText = (
                  dialog.window.document.getElementById(
                    "change-pub-title-old",
                  ) as HTMLInputElement
                ).value;
                const repText = (
                  dialog.window.document.getElementById(
                    "change-pub-title-new",
                  ) as HTMLInputElement
                ).value;
                this.chPubTitle(searchText, repText);
              },
            },
          ],
          children: [
            {
              tag: "div",
              styles: {
                width: "150px",
                padding: padding,
              },
              properties: {
                innerHTML: getString("change-title-bn"),
              },
            },
          ],
        },
        false,
      )
      .open(getString("change-pub-title"), {
        width: 510,
        height: 300,
        centerscreen: true,
        // fitContent: true,
      });
  }

  @example
  // 作者处理对话框：加粗、加星、去粗、去星
  static async dialogAuBoldStar() {
    const dialogData: { [key: string | number]: any } = {
      inputValue: "test",
      checkboxValue: true,
    };
    const dialog = new ztoolkit.Dialog(5, 2)
      .addCell(0, 0, {
        tag: "h1",
        properties: { innerHTML: "Helper Examples" },
      })
      .addCell(1, 0, {
        tag: "h2",
        properties: { innerHTML: "Dialog Data Binding" },
      })
      .addCell(2, 0, {
        tag: "p",
        properties: {
          innerHTML:
            "Elements with attribute 'data-bind' are binded to the prop under 'dialogData' with the same name.",
        },
        styles: {
          width: "200px",
        },
      })
      .addCell(3, 0, {
        tag: "label",
        namespace: "html",
        attributes: {
          for: "dialog-checkbox",
        },
        properties: { innerHTML: "bind:checkbox" },
      })
      .addCell(
        3,
        1,
        {
          tag: "input",
          namespace: "html",
          id: "dialog-checkbox",
          attributes: {
            "data-bind": "checkboxValue",
            "data-prop": "checked",
            type: "checkbox",
          },
          properties: { label: "Cell 1,0" },
        },
        false,
      )
      .addCell(4, 0, {
        tag: "label",
        namespace: "html",
        attributes: {
          for: "dialog-input",
        },
        properties: { innerHTML: "bind:input" },
      })
      .addCell(
        4,
        1,
        {
          tag: "input",
          id: "dialog-input4",
          // attributes: {
          //   "data-bind": "inputValue",
          //   "data-prop": "value",
          //   type: "text",
          // },
        },
        false,
      )
      .addButton("Replace", "replace", {
        noClose: true,
        callback: (e: Event) => {
          const text = (
            dialog.window.document.getElementById(
              "dialog-input4",
            ) as HTMLInputElement
          ).value;
          new ztoolkit.ProgressWindow(config.addonName)
            .createLine({
              text: text,
              type: "success",
              progress: 100,
            })
            .show();

          // ztoolkit.getGlobal("alert")(
          //   text
          // );
        },
      })
      .addButton("Close", "confirm", {
        noClose: false,
        callback: (e: Event) => {
          ztoolkit.getGlobal("alert")(
            `Close dialog with ${dialogData._lastButtonId}.\nCheckbox: ${dialogData.checkboxValue}\nInput: ${dialogData.inputValue}.`,
          );
        },
      })
      // .addButton("Close", "confirm")
      // .addButton("Cancel", "cancel")
      // .addButton("Help", "help", {
      //   noClose: true,
      //   callback: (e) => {
      //     dialogHelper.window?.alert(
      //       "Help Clicked! Dialog will not be closed."
      //     );
      //   },
      // })
      .setDialogData(dialogData)
      .open("Dialog Example", {
        // width: 200,
        // height: 100,
        centerscreen: true,
        fitContent: true,
      });
    // await dialogData.unloadLock.promise;
    // ztoolkit.getGlobal("alert")(
    //   `Close dialog with ${dialogData._lastButtonId}.\nCheckbox: ${dialogData.checkboxValue}\nInput: ${dialogData.inputValue}.`
    // );
    // ztoolkit.log(dialogData);
  }

  /*

    @example
    static async filePickerExample() {
      const path = await new ztoolkit.FilePicker(
        "Import File",
        "open",
        [
          ["PNG File(*.png)", "*.png"],
          ["Any", "*.*"],
        ],
        "image.png"
      ).open();
      ztoolkit.getGlobal("alert")(`Selected ${path}`);
    }
  */
  //进度条
  @example
  static progressWindow(info: string, status: string) {
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({
        text: info,
        type: status,
        progress: 100,
      })
      .show();
  }

  @example
  static progressWindowExample() {
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({
        text: "ProgressWindow Example!",
        type: "success",
        progress: 100,
      })
      .show();
  }
  /*
    @example
    static vtableExample() {
      ztoolkit.getGlobal("alert")("See src/modules/preferenceScript.ts");
    }
    */
}

/*
function replaceBoldStar(firstName: string | undefined) {
  throw new Error("Function not implemented.");
}
*/
