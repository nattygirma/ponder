import { requireNativeModule } from "expo";

type PonderKeyboardNativeModule = {
  show: () => boolean;
};

export const showPonderKeyboard = () => {
  requireNativeModule<PonderKeyboardNativeModule>("PonderKeyboard").show();
};
