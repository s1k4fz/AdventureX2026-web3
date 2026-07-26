# 保单 NFT 化：优化后实施方案与落地状态

## 1. 目标与边界

为现有差分机保单增加可转让的 ERC-721 凭证。用户可以在保单已链上生效（`active`）或结算完成（`settled`）后铸造一枚确定性 NFT，并在应用内预览、恢复同步、查看属性与公开分享。

本次采用独立 `PolicyNFT` 合约、FastAPI metadata/确认服务、React NFT 页面三层架构。现有 `PolicyVault`、`OutcomeOracle` 和已有部署均不修改。

本次只实现和离线验证代码。以下操作属于部署阶段，未在本次执行：

- 不应用远端 Supabase 迁移。
- 不部署 `PolicyNFT`。
- 不请求钱包签名，不广播 Injective 测试网交易。
- 不写入真实业务数据。

## 2. 探索后修正的关键决策

### 2.1 统一 ID namespace

应用的 policy 主键是 UUID。后端将 UUID 作为 16 字节值左填充到 `bytes32`，合约将其转换为 `uint256` tokenId；因此 tokenId 的有效域是 `0..2^128-1`，公开和传输格式是无前导零十进制字符串。

```text
UUID
  -> 0x00000000000000000000000000000000 || uuid.bytes
  -> uint256(policyId)
  -> canonical decimal tokenId
```

`PolicyNFT.mint` 明确拒绝高 128 位非零的 policyId。这避免 Vault 中非 UUID `bytes32` 保单铸造后，其 `tokenURI` 永久无法被后端反解。

### 2.2 “可铸造”不是独立 Vault enum

`PolicyVault.Policy` 只有 `user` 与 `settled`，没有 active 枚举：

- 不存在：`user == address(0)`
- active：`user != address(0) && settled == false`
- settled：`user != address(0) && settled == true`

合约只需要验证保单存在、调用者是 Vault 记录的用户；两种状态都允许 mint。后端和前端同时要求应用状态为 `active | settled` 且 `on_chain_policy_id` 是该 UUID 的确定性编码。

### 2.3 链上状态是确认事实，客户端 hash 不是

`POST confirm-mint` 不信任客户端上传的 `mintTx`：

1. 验证用户拥有数据库保单、状态合格、tokenId 与 UUID 严格一致。
2. 通过 Injective JSON-RPC 调用 `ownerOf(tokenId)`；非零 owner 即证明 token 已存在。NFT 后续转让不使确认失效。
3. 只有 receipt 同时满足成功状态、目标合约地址、交易哈希，以及 `Transfer(address(0), *, tokenId)` topic 时，才保存可选 `nft_mint_tx`。
4. receipt 不可用时仍可根据 `ownerOf` 保存 token 状态，但丢弃不可信 hash。
5. 慢 RPC 完成后才短暂锁定 policy 行并重读，只填空字段，避免并发确认覆盖时间或 hash；网络等待期间不持数据库锁。
6. 已投影的相同 tokenId 幂等返回；冲突 tokenId 失败关闭。

Injective EVM receipt 可能滞后，因此浏览器也以 `ownerOf` 有界轮询确认，而不依赖 `tx.wait()`。

### 2.4 Metadata 隐私门禁

公开 metadata 只包含产品经济指标，不包含以下数据：

- 用户标题、自然语言需求或身份。
- 市场问题文本、AI rationale、原始 intake JSON。
- 钱包地址或内部数据库关系。

只有满足以下任一条件时，公开 metadata 才返回：

- 数据库已确认 `nft_token_id == canonical tokenId`；或
- 数据库同步尚未完成，但配置的 PolicyNFT 合约上 `ownerOf(tokenId)` 已成功返回非零地址。

因此泄露或枚举一个 active policy UUID 不会在铸造前公开经济信息。RPC 异常失败关闭。

### 2.5 标准 ERC-721 与 URL 职责分离

公开 tokenURI 目标：

```http
GET /api/v1/policies/nft/metadata/{decimalTokenId}
```

认证接口仍使用 UUID：

```http
GET  /api/v1/policies/{policyUuid}/nft/preview
POST /api/v1/policies/{policyUuid}/nft/confirm-mint
```

公开展示页：

```text
/nft/{decimalTokenId}
```

配置分工：

- `NFT_BASE_URI`：部署时写入不可变合约，必须等于公开 metadata 路由前缀。
- `NFT_METADATA_BASE_URL`：后端生成 tokenURI/nftMetadataUri 使用。
- `NFT_PUBLIC_BASE_URL`：metadata 的 `external_url`，指向无需登录的 NFT 展示页。
- `POLICY_NFT_ADDRESS`：后端读链与 receipt 校验。
- `VITE_POLICY_NFT_ADDRESS`：浏览器读写合约；未配置时安全禁用 mint。

ERC-721 JSON 保持标准 snake_case：`external_url`、`trait_type`、`display_type`。应用其他 JSON 接口仍使用 camelCase。

部署环境不得省略 `NFT_PUBLIC_BASE_URL`；代码在本地未配置时只保留相对 metadata fallback 以便离线预览，但上线验收必须确认 `external_url` 是公开 `/nft/{tokenId}` 的绝对 URL，不能静默指回 JSON。

## 3. 智能合约实现

### 3.1 `contracts/src/PolicyNFT.sol`

独立、无管理员、不可变 Vault 引用的 ERC-721：

- `mint(bytes32 policyId) returns (uint256)`
- `balanceOf`、`ownerOf`
- `approve`、`getApproved`
- `setApprovalForAll`、`isApprovedForAll`
- `transferFrom`
- 两个 `safeTransferFrom` overload 与 receiver callback/revert 回滚
- `tokenURI`
- ERC-165、ERC-721、ERC-721 Metadata `supportsInterface`
- 标准 `Transfer`、`Approval`、`ApprovalForAll` 事件

约束：

- Vault 地址非零且有 bytecode。
- base URI 非空并统一尾部斜杠。
- policyId 必须属于低 128 位 UUID namespace。
- Vault policy 必须存在，且 `msg.sender == policy.user`。
- 每个确定性 tokenId 只能 mint 一次。

不提供 burn、enumeration、可变 baseURI 或管理员后门。

### 3.2 接口、部署与测试

- `contracts/src/interfaces/IPolicyVault.sol`：只声明 `policies(bytes32)` getter。
- `contracts/script/DeployNFT.s.sol`：读取 `POLICY_VAULT_ADDRESS` 与 `NFT_BASE_URI`，并在脚本内拒绝非 `1439` 链。
- Injective 测试网部署仍必须显式使用 legacy transaction、gasPrice `160000000`，不使用 EIP-1559 字段；交易 envelope 由 Forge CLI 参数控制，chainId 门禁不能替代 `--legacy --with-gas-price 160000000`。
- `contracts/test/PolicyNFT.t.sol` 覆盖配置、mint、UUID 边界、重复/越权、metadata、approval、transfer、safe receiver 与回滚语义。

## 4. 后端实现

### 4.1 数据库

Alembic revision：`a8b9c0d1e2f3`，基于 `f7a8b9c0d1e2`。

`policies` 新增：

- `nft_token_id VARCHAR(39) NULL`
- `nft_mint_tx VARCHAR(66) NULL`
- `nft_minted_at TIMESTAMPTZ NULL`

约束：

- tokenId 必须是 canonical uint128 十进制。
- tx 必须是 `0x` + 64 hex。
- `nft_token_id IS NOT NULL` 的部分唯一索引，允许所有未铸造行保持 NULL。

迁移包含完整 downgrade。部署前使用离线 SQL 审查，之后在受控环境应用并运行 advisors；本次不应用远端迁移。

### 4.2 Metadata 与 SVG

`policy_nft_service.py` 生成确定性 400x400 SVG data URI：

- tier 配色和 position 权重环。
- active 显示最大赔付；settled 区分 `Max Payout` trait、实际 `Payout` trait，并在画面显示 `PAID OUT`。
- Coverage End 使用 ERC-721 date display_type。
- 最多绘制 24 段，SVG 上限 32KB。
- 所有文本在 SVG 边界 XML escape。
- Metadata/SVG 均不插入用户文本。

公开 metadata 有 5 分钟缓存；active 之后仍可能 settled，因此不使用永久缓存。

### 4.3 API

- metadata：公开、canonical decimal tokenId、铸造门禁、404 失败关闭。
- preview：Bearer auth + policy ownership，响应 `image/svg+xml`，带 CSP sandbox、nosniff、private cache。
- confirm：Bearer auth + ownership，验证 chain ID 映射、`ownerOf` 和可选 receipt，幂等投影。
- metadata 链上恢复与 confirm 都在外部 RPC 前结束初始只读事务，RPC 后才用短事务锁行重验，避免慢 RPC 占满小型 Supabase 连接池。
- policy detail 增加 `nftTokenId`、`nftMintTx`、`nftMintedAt`、`nftMetadataUri`。
- policy list 增加 `hasNft`；只暴露与本 policy UUID 匹配的 token 状态。

## 5. 前端实现

### 5.1 Mint 流程

`useMintPolicyNFT`：

1. 重新获取最新 policy，验证钱包已连接、chainId 1439、状态和链上 ID。
2. 验证配置地址有 bytecode。
3. 先读 `ownerOf`。若已经存在，跳过签名，直接恢复数据库投影。
4. 获取全局交易锁，以 legacy type-0 和 gasPrice `160000000` 调用 `mint(bytes32)`。
5. 对 `ownerOf` 做 2 秒一次、最多 60 次的有界轮询。
6. 调用 confirm API，并刷新 detail/list/metadata query。
7. 重复 mint 或 RPC receipt 滞后时，优先恢复已提交链上状态，避免第二次广播。

### 5.2 用户界面

- active/settled 详情页新增 NFT Tab。
- 未部署时仍可查看认证 preview，但按钮解释配置缺失并禁用。
- 展示艺术卡片、traits、步骤状态、tokenId、交易/Blockscout 链接。
- policy 列表已铸造项显示 NFT badge。
- `/collection` 聚合展示所有生效/已结算保单，支持全部、已铸造、待铸造筛选；桌面侧栏、移动底栏与首页快捷入口均可达。
- 看板列表同时标识“已铸造”和“可铸造 NFT”，藏品卡可直达公开凭证或带 `?tab=nft` 的铸造面板。
- `/nft/:tokenId` 是无需登录的公开展示页，包含 artwork、traits、原始 metadata 和 explorer 链接。
- 公开页提供创建个人保单 NFT 的站内回流，并使用语义化页面标题。
- 分享与 X 链接指向公开展示页，不指向受登录保护的 `/policy/:uuid`。
- tokenId `0` 是合法值，不能用数值真假判断误拒绝。

React Query 负责请求缓存与失效；独立请求并行刷新。组件复用现有 shadcn Card、Button、Badge、Skeleton、Separator、Spinner 和语义色。

## 6. 文件落点

新增核心文件：

- `contracts/src/PolicyNFT.sol`
- `contracts/src/interfaces/IPolicyVault.sol`
- `contracts/script/DeployNFT.s.sol`
- `contracts/test/PolicyNFT.t.sol`
- `backend/alembic/versions/a8b9c0d1e2f3_policy_nft_fields.py`
- `backend/services/policy_nft_service.py`
- `backend/tests/test_policy_nft.py`
- `frontend/src/features/wallet/abi/policyNft.ts`
- `frontend/src/features/policy/useMintPolicyNFT.ts`
- `frontend/src/features/policy/policyNftUtils.ts`
- `frontend/src/features/policy/PolicyNFTPanel.tsx`
- `frontend/src/features/policy/NFTShareButton.tsx`
- `frontend/src/pages/PolicyNFTPublicPage.tsx`

现有 policy model/schema/API/service、chain service、配置、路由、详情页、首页列表和环境模板按职责扩展。

## 7. 验收矩阵

### 合约

- 全仓 `forge build`、`forge test -vvv`。
- 标准接口、mint 权限、UUID 上下界、transfer/safeTransfer、approval 与 tokenURI。

### 后端

- tokenId 0、uint128 max、前导零、Unicode digit、超范围。
- metadata snake_case、隐私、XSS escape、大小、最大/实际 payout。
- 未 mint metadata 404；DB 已确认和链上已存在两种公开恢复路径。
- preview ownership 与状态门禁。
- ownerOf revert/畸形/zero/RPC 失败。
- confirm token mismatch、chain ID mismatch、幂等、转让后恢复、未配置。
- receipt status/to/hash/Transfer topics。
- Alembic 单 head、upgrade/downgrade 离线 SQL。

### 前端

- TypeScript production build。
- tokenId 转换 smoke（含 0、uint128 max 和非法值）。
- agent events 与 journey regression smoke。
- NFT 相关文件 ESLint。
- 页面级检查：公开页 valid/invalid/missing 三种状态；认证 NFT Tab 的 preview、mint、恢复和分享流程。
- 藏品页桌面/移动布局、筛选、导航选中态、滚动可达性、无横向溢出与公开页回流。
- build 通过不等于 rendered QA；若 Browser/Playwright 不可用，必须明确标记页面交互未验证。

## 8. 部署顺序与硬门禁

1. 应用 Alembic migration `a8b9c0d1e2f3`，确认单一 head 与数据库约束。
2. 部署可公网访问的 backend metadata URL 和 frontend `/nft/:tokenId`。
3. 以准确的 `NFT_BASE_URI={NFT_METADATA_BASE_URL}/` 部署 `PolicyNFT`；必须使用 `--legacy --with-gas-price 160000000`，脚本另行硬性校验 chainId `1439`。
4. 读取部署 bytecode、`vault()`、`baseURI()`、`supportsInterface`，确认 vault 和 URL。
5. 同时配置：
   - backend `POLICY_NFT_ADDRESS`
   - frontend `VITE_POLICY_NFT_ADDRESS`
   - backend `NFT_METADATA_BASE_URL`
   - backend `NFT_PUBLIC_BASE_URL`
6. 重新部署应用并验证前后端地址一致。
7. 用受控测试保单执行一次真实 mint：
   - nonce 前进；
   - `ownerOf(tokenId)` 等于用户地址；
   - tokenURI 返回 200 标准 JSON；
   - confirm DB 投影完成；
   - 公开页无需登录可见；
   - transfer 后 ownerOf 和 metadata 仍正常。
8. 才将功能标记为测试网 E2E 完成。

## 9. 已知非本次范围

- 合约 baseURI 不可变；域名迁移需要代理/新合约或稳定重定向策略。
- metadata 会随 active -> settled 更新，不是永久冻结快照。
- 未引入 IPFS、链上 SVG、Redis metadata cache、burn 或 enumeration。
- 全前端 lint 中的既有非 NFT 问题不属于本次实现，但应单独清理。
- 未部署、未迁移、未真实签名之前，只能声明实现与离线回归完成，不能声明测试网端到端完成。
