import { HumanctlApplication } from '@humanctl/ui/product';

import { useHumanctlRuntime } from '@/runtime';

export function HumanctlViewport() {
  const { model, dispatch } = useHumanctlRuntime();

  return (
    <HumanctlApplication
      model={model}
      dispatch={dispatch}
      version={__HUMANCTL_VERSION__}
    />
  );
}
