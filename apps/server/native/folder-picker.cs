using System;
using System.Runtime.InteropServices;
using System.Text;

// The Windows Common Item Dialog, in folder-only mode. No PowerShell or WinForms.
internal static class FolderPicker {
    [STAThread]
    private static int Main(string[] args) {
        IFileDialog dialog = null;
        IShellItem initial = null;
        IShellItem result = null;
        try {
            Console.OutputEncoding = new UTF8Encoding(false);
            dialog = (IFileDialog)new FileOpenDialog();
            uint options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | 0x20u | 0x40u | 0x800u | 0x02000000u); // folders, filesystem, existing path, no recent list
            dialog.SetTitle("KWZフォルダを選択してください");
            dialog.SetOkButtonLabel("このフォルダを選択");
            if (args.Length > 0 && System.IO.Directory.Exists(args[0])) {
                Guid iid = typeof(IShellItem).GUID;
                if (SHCreateItemFromParsingName(System.IO.Path.GetFullPath(args[0]), IntPtr.Zero, ref iid, out initial) == 0)
                    dialog.SetFolder(initial);
            }
            int hr = dialog.Show(IntPtr.Zero);
            if (hr == unchecked((int)0x800704C7)) return 0; // cancelled
            Marshal.ThrowExceptionForHR(hr);
            dialog.GetResult(out result);
            string directory;
            result.GetDisplayName(0x80058000u, out directory); // SIGDN_FILESYSPATH
            Console.Write(directory);
            return 0;
        } catch (Exception error) {
            Console.Error.WriteLine(error.Message);
            return 1;
        } finally {
            if (result != null) Marshal.FinalReleaseComObject(result);
            if (initial != null) Marshal.FinalReleaseComObject(initial);
            if (dialog != null) Marshal.FinalReleaseComObject(dialog);
        }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid iid, out IShellItem item);

    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    private class FileOpenDialog { }

    // Declaration order must match the native COM vtable, including unused methods.
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
        void AddPlace(IShellItem item, uint position);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint name, [MarshalAs(UnmanagedType.LPWStr)] out string result);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }
}
