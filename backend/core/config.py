from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# Text and structured LLM traffic uses DeepSeek's OpenAI-compatible endpoint.
# StepFun Realtime stays separate (voice proxy).
_DEFAULT_AI_ROUTES_JSON = (
    '{"text_chat": ['
    '{"platform": "deepseek", "adapter": "openai_compatible",'
    ' "model": "deepseek-v4-pro", "priority": 0, "timeout_s": 60}'
    '], "policy_intake": ['
    '{"platform": "deepseek", "adapter": "openai_compatible",'
    ' "model": "deepseek-v4-pro", "priority": 0, "timeout_s": 60}'
    '], "market_search": ['
    '{"platform": "deepseek", "adapter": "openai_compatible",'
    ' "model": "deepseek-v4-pro", "priority": 0, "timeout_s": 60}'
    '], "market_search_refined": ['
    '{"platform": "deepseek", "adapter": "openai_compatible",'
    ' "model": "deepseek-v4-pro", "priority": 0, "timeout_s": 60}'
    '], "portfolio_compose": ['
    '{"platform": "deepseek", "adapter": "openai_compatible",'
    ' "model": "deepseek-v4-pro", "priority": 0, "timeout_s": 120,'
    ' "extra": {"max_tokens": 16384}}'
    '], "policy_plan_intro": ['
    '{"platform": "deepseek", "adapter": "openai_compatible",'
    ' "model": "deepseek-v4-flash", "priority": 0, "timeout_s": 30}'
    '], "source_brief": ['
    '{"platform": "deepseek", "adapter": "openai_compatible",'
    ' "model": "deepseek-v4-flash", "priority": 0, "timeout_s": 45,'
    ' "extra": {"max_tokens": 2048}}'
    "]}"
)

# Default market-data routing table for 差分机 (Difference Engine): read-only
# Polymarket Gamma provider only (no key). Mirrors SEARCH_ROUTES_JSON — lower
# priority wins, extra carries per-provider knobs. Schema + startup validation
# live in ai/markets/config.py.
_DEFAULT_MARKETS_ROUTES_JSON = (
    '{"polymarket": [{"provider": "polymarket_gamma", "max_items": 40,'
    ' "timeout_s": 12, "priority": 0, "extra": {}}]}'
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    api_v1_prefix: str = "/api/v1"
    api_host: str = "127.0.0.1"
    api_port: int = 18473
    cors_origins: str = "http://127.0.0.1:15432,http://localhost:15432"

    supabase_url: str
    supabase_jwt_audience: str = "authenticated"
    supabase_jwt_secret: str = ""

    database_url: str

    ai_default_timeout_seconds: float = 30
    ai_routes_json: str = _DEFAULT_AI_ROUTES_JSON

    # --- DeepSeek OpenAI-compatible (main agent) ---
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model_pro: str = "deepseek-v4-pro"
    deepseek_model_flash: str = "deepseek-v4-flash"

    # --- A2A remote agent (Task 2+) ---
    a2a_enabled: bool = True
    a2a_url: str = "http://127.0.0.1:18473/a2a"
    a2a_system_user_id: str = ""  # UUID string; required for full_system_task

    # PandaAI / pandaData (A-share financial context for agents).
    # Docs: https://www.pandaaiquant.com/data-service/api-docs?api=data_fetch_doc
    # the pandaai subagent is skipped when disabled or credentials empty.
    pandaai_enabled: bool = False
    pandaai_username: str = ""
    pandaai_password: str = ""
    pandaai_base_url: str = "http://pandadata.pandaaiquant.com"
    pandaai_timeout_seconds: float = 20.0
    pandaai_cache_ttl_seconds: int = 300
    pandaai_modules: str = "index,futures,macro,calendar"

    # --- StepFun Realtime ---
    # Realtime voice uses StepFun; the browser never receives the provider key.
    stepfun_api_key: str = ""

    # Step Plan's official Realtime endpoint. The browser never receives the
    # provider key; api/v1/realtime.py terminates an authenticated WS proxy.
    stepfun_realtime_base_url: str = (
        "wss://api.stepfun.com/step_plan/v1/realtime"
    )
    stepfun_realtime_model: str = "stepaudio-2.5-realtime"
    stepfun_realtime_voice: str = "linjiajiejie"
    stepfun_realtime_instructions: str = (
        "你是 Lemma 的实时语音助手。回答自然、清晰、简洁。"
    )
    realtime_proxy_auth_timeout_seconds: float = 5.0
    # Official Realtime sessions last at most 30 minutes.
    realtime_proxy_max_session_seconds: int = 1800
    realtime_proxy_max_sessions_per_user: int = 2
    realtime_proxy_max_message_bytes: int = 1_048_576
    realtime_proxy_max_audio_chunk_bytes: int = 524_288
    realtime_proxy_require_origin: bool = True

    redis_url: str = "redis://localhost:6379/0"

    # --- 差分机 (Difference Engine): market data (Polymarket, read-only) ---
    # Gamma is anonymous/free; default empty-key so the app/smoke boot without
    # any market credential. Routing schema lives in ai/markets/config.py.
    polymarket_gamma_base_url: str = "https://gamma-api.polymarket.com"
    markets_routes_json: str = _DEFAULT_MARKETS_ROUTES_JSON

    # --- WorldMonitor global intelligence (Agent context + policy UI) ---
    # Public health + bootstrap(?public=1) work without a key. Optional key
    # (cloud wm_… or local WORLDMONITOR_VALID_KEYS) unlocks fear/greed + risk
    # RPCs. Point worldmonitor_api_base_url at a local Docker WM to avoid the
    # cloud Pro key — see ai/worldmonitor/LOCAL.md.
    worldmonitor_api_base_url: str = "https://api.worldmonitor.app"
    worldmonitor_api_key: str = ""
    worldmonitor_timeout_seconds: float = 8.0
    worldmonitor_cache_ttl_seconds: int = 120
    # Cloud public bootstrap is the no-key fallback: when the primary base
    # (often a local Docker WM) is unreachable or only returns an unhealthy /
    # empty snapshot, the client transparently retries against the cloud. The
    # optional key applies to the PRIMARY only — the cloud path uses public
    # endpoints. Set worldmonitor_enable_cloud_fallback=false to pin to primary.
    worldmonitor_cloud_base_url: str = "https://api.worldmonitor.app"
    worldmonitor_enable_cloud_fallback: bool = True

    # --- Bocha (博查) Web Search — server-side only ---
    # Never expose BOCHA_API_KEY to the frontend. Default endpoint matches the
    # official Web Search path; override only if the vendor changes hosts.
    bocha_api_key: str = ""
    bocha_api_base_url: str = "https://api.bocha.cn/v1/web-search"
    bocha_timeout_seconds: float = 12.0
    bocha_cache_ttl_seconds: int = 90
    bocha_default_count: int = 8

    # --- Agent Task controllable runtime budgets ---
    # SEARCH_TIMEOUT_S env override is also read by policy_search for live tests.
    agent_search_timeout_seconds: float = 120.0
    # Once the hard-gate market search has completed, give best-effort intel a
    # short grace window. Slow optional sources are skipped for this run rather
    # than extending time-to-plan.
    agent_intel_grace_seconds: float = 6.0
    agent_refined_search_timeout_seconds: float = 15.0
    agent_compose_timeout_seconds: float = 180.0
    agent_stage_web_search_max: int = 1

    # --- 差分机: Injective EVM testnet chain (see backend/.env) ---
    # Public chain params + platform economics. Secrets (private keys) default
    # empty so the no-chain M1 pipeline boots without them; the settle relayer
    # (M3) and deploy scripts read the keys from .env when present. Legacy tx /
    # no EIP-1559 on Injective EVM testnet, so gas price is a fixed 160e6 wei.
    injective_evm_rpc_url: str = "https://k8s.testnet.json-rpc.injective.network/"
    injective_evm_chain_id: int = 1439
    injective_evm_gas_price_wei: int = 160_000_000
    deployer_private_key: str = ""
    relayer_private_key: str = ""
    treasury_address: str = ""
    platform_fee_bps: int = 100
    # Filled after M2 deploy: the PolicyVault + native USDC (MTS) addresses.
    policy_vault_address: str = ""
    usdc_address: str = ""
    # Separate ERC-721 wrapper.  Metadata generation remains available without
    # it; confirmation fails closed until an address is configured.
    policy_nft_address: str = ""
    # Public API prefix used by tokenURI and detail nftMetadataUri.
    # Example: https://api.example.com/api/v1/policies/nft/metadata
    nft_metadata_base_url: str = ""
    # Public, unauthenticated NFT landing page used by ERC-721 external_url and
    # social sharing. Example: https://app.example.com/nft
    nft_public_base_url: str = ""
    # Filled after M3 oracle deploy: the OutcomeOracle contract that
    # settlePolicyFromOracle reads. Empty until wired; the settle relayer asserts
    # Polymarket outcomes here, waits out the challenge window, then finalizes.
    outcome_oracle_address: str = ""
    # Challenge window (seconds) the relayer waits after asserting before it may
    # finalize an undisputed outcome. Kept short for testnet demos; hours/days in
    # production. Must match the value the OutcomeOracle was deployed with.
    outcome_oracle_liveness_seconds: int = 300
    # Bond posted per assertion (USDC base units, 6 decimals). 10_000_000 = 10 USDC.
    outcome_oracle_bond_base_units: int = 10_000_000

    # --- Rokid Glasses HUD card feed (GET /api/v1/hud/stream) ---
    # Per-connection poll cadence for the four read-only sources. WorldMonitor
    # has its own 120s client cache, so a 20s tick never amplifies upstream.
    hud_poll_interval_seconds: float = 20
    hud_heartbeat_interval_seconds: float = 15
    hud_max_cards: int = 30
    # Dev-only bypass for glasses-demo auth: when BOTH values are set, a Bearer
    # equal to hud_dev_token authenticates /hud/* as hud_dev_user_id — no
    # Supabase login on the phone. Empty (default) = disabled. Never set in prod.
    hud_dev_token: str = ""
    hud_dev_user_id: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def supabase_jwt_issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
