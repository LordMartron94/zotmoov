// ZotMoov
// zotmoov.js
// Written by Wiley Yu


// If this doesn't load, fail anyways
Components.utils.importGlobalProperties(['PathUtils', 'IOUtils']);

Zotero.ZotMoov =
{
    id: null,
    version: null,
    rootURI: null,
    initialized: false,

    _notifierID: null,

    init({ id, version, rootURI })
    {
        if(this.initialized) return;

        this.id = id;
        this.version = version;
        this.rootURI = rootURI;
        this.initialized = true;
        this._notifierID = Zotero.Notifier.registerObserver(this.notifyCallback, ['item'], 'zotmoov', 99);
    },

    destroy()
    {
        Zotero.Notifier.unregisterObserver(this._notifierID);
    },

    _getCopyPath(item, dst_path, into_subfolder, subdir_str)
    {
        let file_path = item.getFilePath();
        let file_name = file_path.split(/[\\/]/).pop();
        let local_dst_path = dst_path;

        // Optionally add subdirectory folder here
        if (into_subfolder)
        {
            let custom_dir = Zotero.ZotMoov.Wildcard.process_string(item, subdir_str);
            local_dst_path = PathUtils.join(local_dst_path, ...custom_dir.split('/'));
        }

        let copy_path = PathUtils.join(local_dst_path, file_name);

        return copy_path;
    },

    async move(items, dst_path, arg_options = {})
    {
        const default_options = {
            ignore_linked: true,
            into_subfolder: false,
            subdir_str: '',
        };

        let options = {...default_options, ...arg_options};


        if (dst_path == '') return;

        let promises = [];
        for (let item of items)
        {
            if (!item.isAttachment()) continue;

            if (options.ignore_linked)
            {
                if (item.attachmentLinkMode != Zotero.Attachments.LINK_MODE_IMPORTED_FILE &&
                    item.attachmentLinkMode != Zotero.Attachments.LINK_MODE_IMPORTED_URL) continue;
            }

            let file_path = item.getFilePath();
            let copy_path = Zotero.ZotMoov._getCopyPath(item, dst_path, options.into_subfolder, options.subdir_str);

            // Have to check since later adding an entry triggers the
            // handler again
            if (file_path == copy_path) continue;

            let clone = item.clone(null, {includeCollections: true});
            clone.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_FILE;
            clone.attachmentPath = copy_path;

            promises.push(IOUtils.move(file_path, copy_path).then(function(clone, item)
                {
                    clone.saveTx().then(async function(id)
                    {
                        await Zotero.DB.executeTransaction(async function()
                        {
                          await Zotero.Items.moveChildItems(item, clone);
                        });
                        Zotero.Fulltext.indexItems(id);// reindex clone after saved
                        item.eraseTx(); // delete original item
                    });
                }.bind(null, clone, item))
            );
        }

        return Promise.allSettled(promises);
    },

    async copy(items, dst_path, arg_options = {})
    {
        const default_options = {
            into_subfolder: false,
        };

        let options = {...default_options, ...arg_options};


        if (dst_path == '') return;

        let promises = [];
        for (let item of items)
        {
            if (!item.isAttachment()) continue;

            let file_path = item.getFilePath();
            let copy_path = Zotero.ZotMoov._getCopyPath(item, dst_path, options.into_subfolder, options.subdir_str);

            if (file_path == copy_path) continue;

            promises.push(IOUtils.copy(file_path, copy_path));
        }

        return Promise.allSettled(promises);
    },

    _getSelectedItems()
    {
        let items = Zotero.getActiveZoteroPane().getSelectedItems();
        let att_ids = [];
        let atts = new Set();
        for (let item of items)
        {
            if (item.isAttachment())
            {
                atts.add(item);
                continue;
            }

            att_ids.push(...item.getAttachments());
        }

        let new_atts = Zotero.Items.get(att_ids);
        new_atts.forEach(att => atts.add(att));

        return atts
    },

    async moveSelectedItems()
    {
        let atts = this._getSelectedItems();
        let dst_path = Zotero.Prefs.get('extensions.zotmoov.dst_dir', true);
        let subfolder_enabled = Zotero.Prefs.get('extensions.zotmoov.enable_subdir_move', true);
        let subdir_str = Zotero.Prefs.get('extensions.zotmoov.subdirectory_string', true);

        if(Zotero.Prefs.get('extensions.zotmoov.file_behavior', true) == 'move')
        {
             await Zotero.ZotMoov.move(atts, dst_path, { ignore_linked: false, into_subfolder: subfolder_enabled, subdir_str: subdir_str });
        } else
        {
            await Zotero.ZotMoov.copy(atts, dst_path, { into_subfolder: subfolder_enabled, subdir_str: subdir_str });
        }
    },

    async moveSelectedItemsCustomDir()
    {
        let atts = this._getSelectedItems();

        let fp = Components.classes['@mozilla.org/filepicker;1'].createInstance(Components.interfaces.nsIFilePicker);
        let wm = Services.wm;
        let win = wm.getMostRecentWindow('navigator:browser');

        fp.init(win, Zotero.getString('dataDir.selectDir'), fp.modeGetFolder);
        fp.appendFilters(fp.filterAll);
        let rv = await new Zotero.Promise(function(resolve)
        {
            fp.open((returnConstant) => resolve(returnConstant));
        });
        if (rv != fp.returnOK) return '';

        if(Zotero.Prefs.get('extensions.zotmoov.file_behavior', true) == 'move')
        {
             await Zotero.ZotMoov.move(atts, fp.file.path, { ignore_linked: false, into_subfolder: false });
        } else
        {
            await Zotero.ZotMoov.copy(atts, fp.file.path, { into_subfolder: false });
        }
    },

    notifyCallback:
    {
        _item_ids: [],
        _timeoutID: 0,

        async execute()
        {
            if (_item_ids.length == 0) return;
            let dst_path = Zotero.Prefs.get('extensions.zotmoov.dst_dir', true);
            let subfolder_enabled = Zotero.Prefs.get('extensions.zotmoov.enable_subdir_move', true);
            let subdir_str = Zotero.Prefs.get('extensions.zotmoov.subdirectory_string', true);

            let items = Zotero.Items.get(Zotero.ZotMoov.notifyCallback._item_ids);
            if(Zotero.Prefs.get('extensions.zotmoov.file_behavior', true) == 'move')
            {
                 await Zotero.ZotMoov.move(items, dst_path, { into_subfolder: subfolder_enabled, subdir_str: subdir_str});
            } else
            {
                await Zotero.ZotMoov.copy(items, dst_path, { into_subfolder: subfolder_enabled, subdir_str: subdir_str });
            }
        },

        async addCallback(event, ids, extraData)
        {
            let auto_move = Zotero.Prefs.get('extensions.zotmoov.enable_automove', true);
            if (!auto_move) return;

            this._item_ids.push(...ids);
        },

        async modifyCallback(event, ids, extraData)
        {
            clearTimeout(this._timeoutID);
            this._timeoutID = setTimeout(this.execute, Zotero.Prefs.get('extensions.zotmoov.auto_process_delay', true));
        },

        async notify(event, type, ids, extraData)
        {
            if (event == 'add') await this.addCallback(event, ids, extraData);
            if (event == 'modify') await this.modifyCallback(event, ids, extraData);
        },
    },
};
