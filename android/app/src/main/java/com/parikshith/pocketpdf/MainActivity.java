package com.parikshith.pocketpdf;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PocketFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
