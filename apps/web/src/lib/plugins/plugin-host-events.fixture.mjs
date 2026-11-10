export default {
  activate(context) {
    const disposeSettings = context.events.on("settings.changed", ({ key }) => {
      globalThis.ponderPluginObservedSettings ??= [];
      globalThis.ponderPluginObservedSettings.push({ pluginId: context.pluginId, key });
    });
    const disposeNote = context.events.on("note.updated", ({ note }) => {
      globalThis.ponderPluginObservedNote = note;
    });
    const disposeTemplate = context.events.on("template.created", ({ template }) => {
      globalThis.ponderPluginObservedTemplate = template;
    });
    const disposeResource = context.events.on("resource.updated", ({ resource }) => {
      globalThis.ponderPluginObservedResource = resource;
    });
    return () => {
      disposeSettings();
      disposeNote();
      disposeTemplate();
      disposeResource();
    };
  },
};
