// Expone LuloSsh (Swift) a React Native. Contrato: src/native/SshModule.ts.
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(LuloSsh, RCTEventEmitter)

RCT_EXTERN_METHOD(connect:(NSDictionary *)opts resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(write:(NSString *)sessionId base64:(NSString *)base64 resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(resize:(NSString *)sessionId cols:(nonnull NSNumber *)cols rows:(nonnull NSNumber *)rows resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(disconnect:(NSString *)sessionId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(acceptHostKey:(NSString *)sessionId accept:(BOOL)accept resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(exec:(NSString *)sessionId command:(NSString *)command timeoutMs:(nonnull NSNumber *)timeoutMs resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(listSessions:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(attach:(NSString *)sessionId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumePendingOpen:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(probeSessions)

RCT_EXTERN_METHOD(unlock:(NSString *)reason resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(secureGet:(NSString *)name resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(secureSet:(NSString *)name value:(NSString *)value resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(secureDelete:(NSString *)name resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(generateKey:(NSString *)keyId comment:(NSString *)comment resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(importKey:(NSString *)keyId pem:(NSString *)pem passphrase:(NSString *)passphrase comment:(NSString *)comment resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(deleteKey:(NSString *)keyId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(showKeyboard)
RCT_EXTERN_METHOD(hideKeyboard:(BOOL)detach)
RCT_EXTERN_METHOD(ensureKeyboardFocus)
RCT_EXTERN_METHOD(setVolumeKeysEnabled:(BOOL)enabled)
RCT_EXTERN_METHOD(prefGet:(NSString *)name resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(prefSet:(NSString *)name value:(NSString *)value resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(reloadUi)

RCT_EXTERN_METHOD(pickImportFiles:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(isJuiceSshInstalled:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(readJuiceSsh:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(exportBackup:(NSString *)metaJson keyIds:(NSArray *)keyIds password:(NSString *)password fileName:(NSString *)fileName resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(decryptBackup:(NSString *)content password:(NSString *)password resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(decryptXshellPasswords:(NSString *)master blobs:(NSArray *)blobs resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(copyText:(NSString *)text)
RCT_EXTERN_METHOD(pasteText:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)

@end
