// Enki Browser's main executable on macOS. It only runs Contents/Resources/enki/enki-browser.sh,
// which starts Chromium with Enki Browser's profile, extensions and switches.
//
// The script is not the main executable itself because a script's code signature lives in
// extended attributes, which copies and archives drop, leaving an app macOS calls damaged; a
// small Mach-O signs like any program, and the script is sealed as one of the bundle's resources.
// Both steps exec, so the browser ends up in this same process: one app for macOS and the Dock.
#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
  char exe[PATH_MAX];
  uint32_t size = sizeof exe;
  char real[PATH_MAX];
  if (_NSGetExecutablePath(exe, &size) != 0 || realpath(exe, real) == NULL) {
    fprintf(stderr, "Enki Browser: cannot find its own location\n");
    return 1;
  }
  char script[PATH_MAX];
  // real is …/Enki Browser.app/Contents/MacOS/Enki Browser
  snprintf(script, sizeof script, "%s/../Resources/enki/enki-browser.sh", dirname(real));

  char **args = calloc((size_t)argc + 2, sizeof *args);
  if (args == NULL) return 1;
  args[0] = "/bin/bash";
  args[1] = script;
  for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
  execv("/bin/bash", args);
  perror("Enki Browser: cannot start");
  return 1;
}
