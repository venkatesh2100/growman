export type RootStackParamList = {
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
  Main: undefined;
  ProductDetail: { product: any };
  Checkout: undefined;
  Orders: undefined;
  Category: { categorySlug: string };
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

