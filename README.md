# CareerLens 职镜

简历解析与多来源岗位匹配网站。前端由 GitHub Pages 托管，岗位查询调用已上线网关。

## 通过 GitHub 网页上传并发布

1. 登录账号 YoushiChang，访问 https://github.com/new 。仓库名称填写 careerlens，选择 Public（公开），点击 Create repository。
2. 在新仓库的 Quick setup 区域点击 uploading an existing file；已有文件的仓库使用 Add file → Upload files。
3. 把本地 github-upload 文件夹里的全部文件和 assets、gateway 文件夹拖入网页。上传的是文件夹的内容，不能把 github-upload 当作外层文件夹上传；index.html 必须位于仓库根目录。不要上传 ZIP 本身，GitHub 不会替你解压。
4. 点击 Commit changes 提交文件到 main 分支。
5. 进入 Settings → Pages，Source 选择 Deploy from a branch，Branch 选择 main，Folder 选择 / (root)，点击 Save。
6. 等待 GitHub 完成发布；以 Settings → Pages 显示的网址为准。仓库名为 careerlens 时，预期网址为 https://youshichang.github.io/careerlens/ 。

## 功能说明

- GitHub Pages 只运行页面；岗位查询继续由 https://careerlens-zys.plaidatoll2.chatgpt.site 提供。
- 网关允许来自 https://youshichang.github.io 的跨站岗位查询。仓库名称可以不同，但更换 GitHub 账号或自定义域名需要重新配置网关允许的域名。
- assets/api-config.js 已填写网关网址；不要把 API Key 写进这个文件或上传到公开仓库。
- 不填写 DeepSeek Key 时可本地提取 PDF / DOCX 的基础画像；填写后使用增强解析。
- 来源角标显示每次查询的实际状态，不保证所有招聘来源一直可用。
- gateway 与 server.cjs 是本地网关源码，GitHub Pages 不会执行它们。若需本地运行，请把 assets/api-config.js 中网关地址改为空字符串，再运行 node server.cjs。

GitHub 官方发布说明：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
