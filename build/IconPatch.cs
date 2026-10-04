// Build tool: replaces every icon group in a Windows PE file (chrome.exe, chrome.dll) with one
// .ico, and can verify the result.
//
//   IconPatch.exe <file> <icon.ico>            replace
//   IconPatch.exe --verify <file> <icon.ico>   exit 0 only if every group now holds that icon
//
// Why every group, and chrome.dll too: Windows shows chrome.exe's first icon for the file, but
// Chromium sets its windows' taskbar and Alt+Tab icon from chrome.dll's IDR_MAINFRAME. Replacing
// only chrome.exe's main icon (what rcedit does) left the taskbar showing Chromium's logo.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

static class IconPatch
{
    const uint LOAD_LIBRARY_AS_DATAFILE = 0x2, LOAD_LIBRARY_AS_IMAGE_RESOURCE = 0x20;
    static readonly IntPtr RT_ICON = (IntPtr)3, RT_GROUP_ICON = (IntPtr)14;

    delegate bool EnumNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
    delegate bool EnumLangProc(IntPtr module, IntPtr type, IntPtr name, ushort lang, IntPtr param);

    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32", SetLastError = true)] static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32", SetLastError = true)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNameProc proc, IntPtr param);
    [DllImport("kernel32", SetLastError = true)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLangProc proc, IntPtr param);
    [DllImport("kernel32", SetLastError = true)] static extern IntPtr FindResourceEx(IntPtr module, IntPtr type, IntPtr name, ushort lang);
    [DllImport("kernel32", SetLastError = true)] static extern IntPtr LoadResource(IntPtr module, IntPtr res);
    [DllImport("kernel32", SetLastError = true)] static extern IntPtr LockResource(IntPtr data);
    [DllImport("kernel32", SetLastError = true)] static extern uint SizeofResource(IntPtr module, IntPtr res);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32", SetLastError = true)] static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
    [DllImport("kernel32", SetLastError = true)] static extern bool EndUpdateResource(IntPtr update, bool discard);

    /// A resource name: an integer id, or a string (kept as its text).
    sealed class ResName
    {
        public int Id = -1; public string Text;
        public IntPtr Ptr() { return Text == null ? (IntPtr)Id : Marshal.StringToHGlobalUni(Text); }
        public override string ToString() { return Text ?? ("#" + Id); }
    }

    static ResName ReadName(IntPtr name)
    {
        long v = name.ToInt64();
        return (v >> 16) == 0 ? new ResName { Id = (int)v } : new ResName { Text = Marshal.PtrToStringUni(name) };
    }

    sealed class Image { public byte Width, Height, Colors; public ushort Planes, Bits; public byte[] Data; }

    static List<Image> ReadIco(string path)
    {
        byte[] b = File.ReadAllBytes(path);
        int count = BitConverter.ToUInt16(b, 4);
        var images = new List<Image>();
        for (int i = 0; i < count; i++)
        {
            int e = 6 + i * 16;
            int size = BitConverter.ToInt32(b, e + 8), offset = BitConverter.ToInt32(b, e + 12);
            images.Add(new Image
            {
                Width = b[e], Height = b[e + 1], Colors = b[e + 2],
                Planes = BitConverter.ToUInt16(b, e + 4), Bits = BitConverter.ToUInt16(b, e + 6),
                Data = b.Skip(offset).Take(size).ToArray(),
            });
        }
        return images;
    }

    /// Every icon group with its languages, and the highest RT_ICON id in use.
    static List<KeyValuePair<ResName, ushort>> Groups(string file, out int maxIconId)
    {
        IntPtr module = LoadLibraryEx(file, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE);
        if (module == IntPtr.Zero) throw new Win32Exception();
        var groups = new List<KeyValuePair<ResName, ushort>>();
        int max = 0;
        try
        {
            EnumResourceNames(module, RT_GROUP_ICON, (m, t, n, p) =>
            {
                var name = ReadName(n);
                EnumResourceLanguages(m, t, n, (m2, t2, n2, lang, p2) => { groups.Add(new KeyValuePair<ResName, ushort>(name, lang)); return true; }, IntPtr.Zero);
                return true;
            }, IntPtr.Zero);
            EnumResourceNames(module, RT_ICON, (m, t, n, p) => { var name = ReadName(n); if (name.Id > max) max = name.Id; return true; }, IntPtr.Zero);
        }
        finally { FreeLibrary(module); }
        maxIconId = max;
        return groups;
    }

    static int Replace(string file, string icoPath)
    {
        var images = ReadIco(icoPath);
        int maxIconId;
        var groups = Groups(file, out maxIconId);
        if (groups.Count == 0) throw new Exception(file + " has no icon groups");

        IntPtr update = BeginUpdateResource(file, false);
        if (update == IntPtr.Zero) throw new Win32Exception();
        int nextId = maxIconId + 1;
        foreach (var g in groups)
        {
            // Each group gets its own copies of the images, under fresh ids, in its own language.
            var dir = new MemoryStream();
            var w = new BinaryWriter(dir);
            w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)images.Count);
            foreach (var img in images)
            {
                int id = nextId++;
                if (!UpdateResource(update, RT_ICON, (IntPtr)id, g.Value, img.Data, (uint)img.Data.Length)) throw new Win32Exception();
                w.Write(img.Width); w.Write(img.Height); w.Write(img.Colors); w.Write((byte)0);
                w.Write(img.Planes); w.Write(img.Bits); w.Write((uint)img.Data.Length); w.Write((ushort)id);
            }
            byte[] grp = dir.ToArray();
            IntPtr name = g.Key.Ptr();
            try { if (!UpdateResource(update, RT_GROUP_ICON, name, g.Value, grp, (uint)grp.Length)) throw new Win32Exception(); }
            finally { if (g.Key.Text != null) Marshal.FreeHGlobal(name); }
        }
        if (!EndUpdateResource(update, false)) throw new Win32Exception();
        Console.WriteLine("  replaced " + groups.Count + " icon group(s) in " + Path.GetFileName(file));
        return 0;
    }

    /// Every group must point at images byte-identical to the .ico's largest image.
    static int Verify(string file, string icoPath)
    {
        byte[] expected = ReadIco(icoPath).OrderByDescending(i => i.Data.Length).First().Data;
        int maxIconId;
        var groups = Groups(file, out maxIconId);
        IntPtr module = LoadLibraryEx(file, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE);
        int bad = 0;
        try
        {
            foreach (var g in groups)
            {
                IntPtr name = g.Key.Ptr();
                byte[] grp = Read(module, RT_GROUP_ICON, name, g.Value);
                if (g.Key.Text != null) Marshal.FreeHGlobal(name);
                int count = BitConverter.ToUInt16(grp, 4);
                bool found = false;
                for (int i = 0; i < count && !found; i++)
                {
                    int id = BitConverter.ToUInt16(grp, 6 + i * 14 + 12);
                    found = Read(module, RT_ICON, (IntPtr)id, g.Value).SequenceEqual(expected);
                }
                if (!found) { bad++; Console.WriteLine("  group " + g.Key + " (lang " + g.Value + ") does not hold the icon"); }
            }
        }
        finally { FreeLibrary(module); }
        Console.WriteLine("  " + (groups.Count - bad) + "/" + groups.Count + " icon groups in " + Path.GetFileName(file) + " hold the Enki icon");
        return bad == 0 ? 0 : 1;
    }

    static byte[] Read(IntPtr module, IntPtr type, IntPtr name, ushort lang)
    {
        IntPtr res = FindResourceEx(module, type, name, lang);
        if (res == IntPtr.Zero) return new byte[0];
        uint size = SizeofResource(module, res);
        IntPtr ptr = LockResource(LoadResource(module, res));
        var data = new byte[size];
        Marshal.Copy(ptr, data, 0, (int)size);
        return data;
    }

    static int Main(string[] args)
    {
        try
        {
            if (args.Length == 3 && args[0] == "--verify") return Verify(args[1], args[2]);
            if (args.Length == 2) return Replace(args[0], args[1]);
            Console.Error.WriteLine("usage: IconPatch.exe [--verify] <file> <icon.ico>");
            return 2;
        }
        catch (Exception e) { Console.Error.WriteLine("IconPatch: " + e.Message); return 1; }
    }
}
