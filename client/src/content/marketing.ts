/**
 * Marketing campaigns are content data, same reasoning as content/staff.ts:
 * `boost` is read by sim/economy.ts's attendance calc, `label`/`cost`/`days`
 * are read by the marketing UI, and having two copies is how they'd drift.
 */

export type MarketingCampaignId = 'radio' | 'billboard' | 'influencer';

export interface MarketingCampaignDef {
  label: string;
  cost: number;
  days: number;
  boost: number;
}

export const MARKETING_CAMPAIGNS: Record<MarketingCampaignId, MarketingCampaignDef> = {
  radio: { label: 'Local Radio Spot', cost: 600, days: 3, boost: 0.25 },
  billboard: { label: 'Highway Billboard', cost: 1500, days: 5, boost: 0.5 },
  influencer: { label: 'Influencer Tour', cost: 3200, days: 7, boost: 0.9 },
};
