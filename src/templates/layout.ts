export interface Brand {
  name: string;
  supportEmail?: string;
  orderUrl?: (code: string) => string;
  url?: string;
}
