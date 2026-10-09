// How the stub and the launcher read their command line, and how they pass a URL on to Chromium.
//
// Windows opens a link or a file in Enki Browser with the command it was registered with:
//   "<root>\EnkiBrowser.exe" --single-argument %1
// and puts the URL or path in place of %1 exactly as it is: unquoted, possibly with spaces,
// quotes or text that looks like a switch. A crafted link such as "--gpu-launcher=calc" must never
// become a Chromium switch. Chromium has a defence built in: on Windows, everything after
// "--single-argument " on the raw command line is one argument, taken literally, never parsed
// (base/command_line.cc, ParseAsSingleArgument). It only works if that text reaches chrome.exe
// untouched and last. Splitting it into .NET's args[] and quoting it back would undo it: the
// pieces could carry switches (to Chromium, or to the stub itself: "--uninstall /S"), and a quoted
// path would arrive with its quotes. So:
//  - only the arguments BEFORE --single-argument are read as arguments (Head);
//  - the text after it (Raw) is carried from the raw command line (Environment.CommandLine) to
//    chrome.exe's command line unchanged, after every switch Enki adds.
using System;
using System.Collections.Generic;
using System.Linq;

static class Args
{
    public const string SingleArgument = "--single-argument";

    /// What a command line means to Enki: the arguments before --single-argument, and the literal
    /// text after it (null when there is none).
    public sealed class Parsed
    {
        public string[] Head;
        public string Raw;
    }

    /// `commandLine` is the raw command line (Environment.CommandLine) and `args` is .NET's split of
    /// it (Main's argument), which does not include the program.
    public static Parsed Parse(string commandLine, string[] args)
    {
        int at = Array.IndexOf(args, SingleArgument);
        if (at < 0) return new Parsed { Head = args, Raw = null };
        return new Parsed { Head = args.Take(at).ToArray(), Raw = RawAfterSwitch(commandLine) };
    }

    /// The text after "--single-argument " in a raw command line, as Chromium takes it: from one
    /// character past the switch to the end. The program path is skipped first, so a folder named
    /// like the switch cannot be mistaken for it. Null when there is no text, and for a literal
    /// "%1" (a registered command run without a URL, as Windows does for the Start menu entry).
    public static string RawAfterSwitch(string commandLine)
    {
        if (string.IsNullOrEmpty(commandLine)) return null;
        int start = ProgramEnd(commandLine);
        int search = start;
        while (true)
        {
            int at = commandLine.IndexOf(SingleArgument, search, StringComparison.Ordinal);
            if (at < 0) return null;
            int after = at + SingleArgument.Length;
            bool startsArgument = at == 0 || char.IsWhiteSpace(commandLine[at - 1]);
            bool endsSwitch = after == commandLine.Length || char.IsWhiteSpace(commandLine[after]);
            if (startsArgument && endsSwitch)
            {
                if (after + 1 >= commandLine.Length) return null;
                string raw = commandLine.Substring(after + 1);
                return raw.Length == 0 || raw.Trim() == "%1" ? null : raw;
            }
            search = after;
        }
    }

    /// Where the program path ends in a raw command line: CommandLineToArgvW takes the first
    /// argument up to the closing quote if it starts with one, otherwise up to the first space.
    static int ProgramEnd(string commandLine)
    {
        int i = 0;
        while (i < commandLine.Length && char.IsWhiteSpace(commandLine[i])) i++;
        if (i < commandLine.Length && commandLine[i] == '"')
        {
            int close = commandLine.IndexOf('"', i + 1);
            return close < 0 ? commandLine.Length : close + 1;
        }
        while (i < commandLine.Length && !char.IsWhiteSpace(commandLine[i])) i++;
        return i;
    }

    /// Arguments quoted for CommandLineToArgvW, then " --single-argument <raw>" last when there is
    /// a raw argument. Nothing may follow it: Chromium takes the rest of the line as that argument.
    /// Chromium looks for the first "--single-argument" after the program, anywhere in the text: if
    /// one of the arguments contained it (a profile folder named so), the URL is dropped rather
    /// than let Chromium cut the line in the wrong place.
    public static string Compose(IEnumerable<string> arguments, string raw)
    {
        string joined = Win.JoinArgs(arguments);
        if (raw == null || joined.IndexOf(SingleArgument, StringComparison.Ordinal) >= 0) return joined;
        return (joined.Length > 0 ? joined + " " : "") + SingleArgument + " " + raw;
    }

    /// The switches a restart into an update passes again: never --single-argument (it would turn
    /// the next switch into a "URL"), and --restore-last-session exactly once, at the end.
    public static List<string> RestartSwitches(IEnumerable<string> switches)
    {
        var list = switches.Where(a => a != SingleArgument && a != "--restore-last-session").ToList();
        list.Add("--restore-last-session");
        return list;
    }
}
