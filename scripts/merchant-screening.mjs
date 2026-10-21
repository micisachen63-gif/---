// User-defined operational screening. Retention is not identity confirmation.
export const MERCHANT_SCREENING_RULE_VERSION='2026-10-21-cash-and-monthly-breadth';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
function eligible(e,input){return e?.verified===true&&e.platform===input.platform&&String(e.aid)===String(input.aid)&&validDate(e.from)&&validDate(e.through)&&e.from<=e.through&&e.from.slice(0,7)===e.through.slice(0,7)&&Number.isSafeInteger(e.counterparties)&&e.counterparties>=0;}
export function screenMerchantEvidence(input={}){
 if(typeof input.platform!=='string'||!input.platform||typeof input.aid!=='string'||!input.aid)throw Error('merchant_screening_identity_required');
 const cash=typeof input.lifetimeCash==='number'&&Number.isFinite(input.lifetimeCash)&&input.lifetimeCash>=0?input.lifetimeCash:null;
 const current=eligible(input.currentGift,input)?input.currentGift:null;
 const history=(input.monthlyEvidence??[]).filter(e=>eligible(e,input));
 const twenty=history.filter(e=>e.counterparties>=20);
 const fullCurrent=current&&validDate(input.expectedFrom)&&validDate(input.expectedThrough)&&input.expectedFrom.endsWith('-01')&&current.from===input.expectedFrom&&current.through===input.expectedThrough;
 let category;
 if(input.knownRole?.kind==='streamer'&&input.knownRole.confirmed===true)category='excluded_known_streamer';
 else if(input.userConfirmed===true)category='confirmed_by_user';
 else if(current?.counterparties>=20)category='retained_current_breadth';
 else if(twenty.length)category='retained_historical_breadth';
 else if(cash===null)category='review_missing_lifetime';
 else if(cash>10000)category=fullCurrent?'excluded_high_cash':'review_incomplete_month';
 else if(cash<1000)category=!current?'review_missing_gift':current.counterparties<=2?'review_narrow_low_cash':'retained_low_cash';
 else category='review_middle_cash';
 const retained=category==='confirmed_by_user'||category.startsWith('retained_');
 const counts=[...history.map(e=>e.counterparties),...(current?[current.counterparties]:[])];
 return{ruleVersion:MERCHANT_SCREENING_RULE_VERSION,platform:input.platform,aid:input.aid,category,retained,needsReview:category.startsWith('review_'),excluded:category.startsWith('excluded_'),identityConfirmed:input.userConfirmed===true&&category==='confirmed_by_user',includeInActualRevenue:false,lifetimeCash:cash,currentCounterparties:current?.counterparties??null,currentPeriod:current?{from:current.from,through:current.through}:null,currentMonthCoverageComplete:!!fullCurrent,maxObservedSingleMonthCounterparties:counts.length?Math.max(...counts):null,historicalTwentyMonths:[...new Set(twenty.map(e=>e.from.slice(0,7)))].sort(),firstDepositCount:null,firstDepositOnlyVerified:false};
}
