# Red Frog

[![zotero target version](https://img.shields.io/badge/Zotero-7.*/8.*-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![version](https://img.shields.io/github/package-json/v/shanxiao-studio/zotero-redfrog?style=flat-square)](https://github.com/shanxiao-studio/zotero-redfrog/releases/)
[![download number](https://img.shields.io/github/downloads/shanxiao-studio/zotero-redfrog/latest/total?style=flat-square)](https://github.com/shanxiao-studio/zotero-redfrog/releases/)
[![license](https://img.shields.io/github/license/shanxiao-studio/zotero-redfrog?style=flat-square)](#license)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

感谢 [Green Frog](https://github.com/redleafnew/zotero-updateifsE) 提供的原始代码，Red Frog 在其基础上增加（修改）了一些自己觉得好用的功能，欢迎使用和反馈。

## 功能

- “一键更新“ 文献指标（分区、影响因子等）
- 增加“分区“列，统一显示文献的不同分区信息
- 根据文献类别分别显示出版社和会议名称
- 可以给文献添加评分
- [x] 并入 [Google Scholar citation Count](https://github.com/justinribeiro/zotero-google-scholar-citation-count) 功能

## 安装方法

1. 点击下方链接下载插件.xpi文件，然后在Zotero或JurisM中通过工具-插件-Install Plugin From File...安装。
   - [最新版](https://github.com/redleafnew/zotero-updateifsE/releases/latest)
   - [历史版本](https://github.com/redleafnew/zotero-updateifsE/releases)

   _注意_：火狐浏览器用户请通过在链接上右击，选择“另存为”来下载 .xpi 文件。

2. 到[easyScholar](https://easyscholar.cc/)注册账号并登录，点击注册的用户名-`用户信息`-`开放接口`，复制密钥。在Zotero中点击`编辑`-`设置`-`红青蛙`，粘贴到easyScholar密钥后的文本框内。

   ![密钥](./img/secretkey.png "密钥")

## License 声明

本仓库基于 https://github.com/redleafnew/zotero-updateifsE fork 并进行修改，原始版权与许可信息保持不变，新增内容继续遵循 AGPL-3.0-or-later。
