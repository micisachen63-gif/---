import {PRIVATE_ROSTERS} from './private-rosters.mjs';
// Authority is scoped by platform + AID. Nicknames and special-account lists
// alone never add an account to this registry. Exact confirmation time was not
// supplied, so record the Taiwan calendar date without inventing a timestamp.
const confirmedOnTaipei='2026-10-20',timezone='Asia/Taipei';
const previous='使用者先前明確指定的正式幣商AID；本次沿用';
const newlyConfirmed='使用者對八個候選明確回覆「全部正確」';
const entry=(host,accounts,evidence)=>({host,status:'confirmed_by_user',confirmationSource:'使用者明確確認',confirmedOnTaipei,confirmedAt:null,timezone,evidence,accounts:accounts.map(([aid,nickname])=>({aid,nickname}))});
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export const MERCHANT_IDENTITY_REGISTRY=freeze(PRIVATE_ROSTERS.owned);
export const CONFIRMED_MERCHANTS=freeze(Object.fromEntries(Object.entries(MERCHANT_IDENTITY_REGISTRY.platforms).map(([key,value])=>[key,value.accounts.map(account=>account.aid)])));
export const MERCHANT_PLATFORM_ORDER=freeze(Object.keys(MERCHANT_IDENTITY_REGISTRY.platforms));
export function merchantConfirmation(platform){const identity=MERCHANT_IDENTITY_REGISTRY.platforms[platform];return identity?{merchantIdentityStatus:identity.status,merchantIdentitySource:identity.confirmationSource,merchantIdentityConfirmedOnTaipei:identity.confirmedOnTaipei,merchantIdentityConfirmedAt:identity.confirmedAt,merchantIdentityTimezone:identity.timezone,merchantIdentityEvidence:identity.evidence,identitySource:identity.confirmationSource,confirmedAt:identity.confirmedOnTaipei,confirmationPrecision:'date',confirmationTimestamp:null}:null;}
