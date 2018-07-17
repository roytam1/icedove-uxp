Components.utils.import("resource://testing-common/mailnews/localAccountUtils.js");

function run_test()
{
  localAccountUtils.loadLocalMailAccount();

  // Due to the import code using nsIAbManager off the main thread, we need
  // to ensure that it is initialized before we start the main test.
  let abMgr = MailServices.ab;

  // Import incoming filters.
  let file = do_get_file("resources/becky/filters/IFilter.def");
  let helper1 = new FiltersImportHelper(file, "Becky!",
                                        { count: 3, enabled: 2, incoming: 3, outgoing: 0 });
  helper1.beginImport();

  // Import outgoing filters.
  file = do_get_file("resources/becky/filters/OFilter.def");
  let helper2 = new FiltersImportHelper(file, "Becky!",
                                        { count: 6, enabled: 4, incoming: 3, outgoing: 3 });
  helper2.beginImport();

  // Import both filter types automatically.
  file = do_get_file("resources/becky/filters");
  let helper3 = new FiltersImportHelper(file, "Becky!",
                                        { count: 12, enabled: 8, incoming: 6, outgoing: 6 });
  helper3.beginImport();
}
