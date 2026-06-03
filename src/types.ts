export interface ProdVariant {
  _id: string;
  prod: string;
  label: string;
  price: number;
  amount?: number;
  _delete?: boolean;
}

export interface Product {
  _id: string;
  name: string;
  price: number;
  amount: number;
  removed?: boolean;
  obs?: string;
  codeRef?: string;
  variation?: ProdVariant[];
}

export interface ClientLoad {
  name?: string;
  tel?: string;
}

export interface OperatorLoad {
  name?: string;
}

export interface AddressLoad {
  road?: string;
  number?: string | number;
  complement?: string;
  neighborhood?: string;
  city?: string;
}

export interface OrderMeta {
  order_type?: string;
}

export interface OrderData {
  num: string | number;
  created_at: string;
  prods?: Product[];
  withdraw?: string;
  to_table?: string;
  current_fare?: number;
  payType?: string;
  returnTo?: number;
  clientLoad?: ClientLoad | null;
  operatorLoad?: OperatorLoad | null;
  observation?: string;
  addressLoad?: AddressLoad | null;
  order?: OrderMeta | null;
}

export interface SocketPrintPayload {
  id: string;
  clientId: string;
  order: OrderData;
}
