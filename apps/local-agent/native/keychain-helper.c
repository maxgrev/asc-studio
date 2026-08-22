#define __STDC_WANT_LIB_EXT1__ 1

#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_SECRET_BYTES (2U * 1024U * 1024U)
#define FRAME_PREFIX "ASCSTUDIO1:"
#define FRAME_PREFIX_BYTES 11U
#define FRAME_LENGTH_BYTES 8U
#define FRAME_HEADER_BYTES (FRAME_PREFIX_BYTES + FRAME_LENGTH_BYTES + 1U)
#define EXIT_NOT_FOUND 44
#define EXIT_DENIED 77
#define EXIT_UNAVAILABLE 70

static void release_if_present(CFTypeRef value) {
  if (value != NULL) CFRelease(value);
}

static CFStringRef string_from_utf8(const char *value) {
  return CFStringCreateWithCString(kCFAllocatorDefault, value, kCFStringEncodingUTF8);
}

static int is_lower_hex(char value) {
  return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f');
}

static uint8_t lower_hex_value(uint8_t value) {
  return value <= (uint8_t)'9'
    ? (uint8_t)(value - (uint8_t)'0')
    : (uint8_t)(value - (uint8_t)'a' + 10U);
}

static int valid_account(const char *value) {
  static const char prefix[] = "v1.";
  if (strncmp(value, prefix, sizeof(prefix) - 1) != 0) return 0;
  const char *uuid = value + sizeof(prefix) - 1;
  if (strlen(uuid) < 38) return 0;
  for (size_t index = 0; index < 36; index += 1) {
    if (index == 8 || index == 13 || index == 18 || index == 23) {
      if (uuid[index] != '-') return 0;
    } else if (!is_lower_hex(uuid[index])) return 0;
  }
  if (uuid[14] != '4' || (uuid[19] != '8' && uuid[19] != '9' && uuid[19] != 'a' && uuid[19] != 'b')) return 0;
  const char *kind = uuid + 36;
  return strcmp(kind, ".openai") == 0
    || strcmp(kind, ".app-store-connect") == 0
    || strcmp(kind, ".apple-ads") == 0;
}

static CFStringRef label_for_account(const char *account) {
  size_t length = strlen(account);
  if (length >= 7 && strcmp(account + length - 7, ".openai") == 0) return CFRetain(CFSTR("ASC Studio — OpenAI"));
  if (length >= 18 && strcmp(account + length - 18, ".app-store-connect") == 0) return CFRetain(CFSTR("ASC Studio — App Store Connect"));
  return CFRetain(CFSTR("ASC Studio — Apple Ads"));
}

static int mapped_status(OSStatus status) {
  if (status == errSecItemNotFound) return EXIT_NOT_FOUND;
  if (status == errSecAuthFailed || status == errSecUserCanceled || status == errSecInteractionNotAllowed) {
    return EXIT_DENIED;
  }
  return EXIT_UNAVAILABLE;
}

static CFMutableDictionaryRef make_identity(CFStringRef account, CFStringRef service) {
  CFMutableDictionaryRef identity = CFDictionaryCreateMutable(
    kCFAllocatorDefault,
    0,
    &kCFTypeDictionaryKeyCallBacks,
    &kCFTypeDictionaryValueCallBacks
  );
  if (identity == NULL) return NULL;
  CFDictionarySetValue(identity, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(identity, kSecAttrAccount, account);
  CFDictionarySetValue(identity, kSecAttrService, service);
  return identity;
}

static CFMutableDictionaryRef make_query(
  CFStringRef account,
  CFStringRef service,
  SecKeychainRef keychain
) {
  CFMutableDictionaryRef query = make_identity(account, service);
  if (query == NULL) return NULL;
  const void *values[] = { keychain };
  CFArrayRef search = CFArrayCreate(
    kCFAllocatorDefault,
    values,
    1,
    &kCFTypeArrayCallBacks
  );
  if (search == NULL) {
    CFRelease(query);
    return NULL;
  }
  CFDictionarySetValue(query, kSecMatchSearchList, search);
  CFRelease(search);
  return query;
}

static SecAccessRef make_empty_access(CFStringRef label) {
  CFArrayRef trusted = CFArrayCreate(
    kCFAllocatorDefault,
    NULL,
    0,
    &kCFTypeArrayCallBacks
  );
  if (trusted == NULL) return NULL;
  SecAccessRef access = NULL;
  OSStatus status = SecAccessCreate(label, trusted, &access);
  CFRelease(trusted);
  return status == errSecSuccess ? access : NULL;
}

static uint8_t *read_stdin(size_t *length) {
  const size_t allocation_size = FRAME_HEADER_BYTES + MAX_SECRET_BYTES + 1U;
  size_t used = 0;
  uint8_t *buffer = malloc(allocation_size);
  if (buffer == NULL) return NULL;

  for (;;) {
    if (used == allocation_size) break;
    ssize_t count = read(STDIN_FILENO, buffer + used, allocation_size - used);
    if (count > 0) {
      used += (size_t)count;
      continue;
    }
    if (count == 0) break;
    if (errno == EINTR) continue;
    (void)memset_s(buffer, used, 0, used);
    free(buffer);
    return NULL;
  }

  if (
    used < FRAME_HEADER_BYTES
    || used > FRAME_HEADER_BYTES + MAX_SECRET_BYTES
    || memcmp(buffer, FRAME_PREFIX, FRAME_PREFIX_BYTES) != 0
    || buffer[FRAME_HEADER_BYTES - 1U] != (uint8_t)'\n'
  ) {
    (void)memset_s(buffer, used, 0, used);
    free(buffer);
    errno = used > FRAME_HEADER_BYTES + MAX_SECRET_BYTES ? EFBIG : EINVAL;
    return NULL;
  }

  size_t declared_length = 0;
  for (size_t index = 0; index < FRAME_LENGTH_BYTES; index += 1U) {
    uint8_t digit = buffer[FRAME_PREFIX_BYTES + index];
    if (!is_lower_hex((char)digit)) {
      (void)memset_s(buffer, used, 0, used);
      free(buffer);
      errno = EINVAL;
      return NULL;
    }
    declared_length = (declared_length << 4U) | lower_hex_value(digit);
  }

  if (
    declared_length == 0
    || declared_length > MAX_SECRET_BYTES
    || used != FRAME_HEADER_BYTES + declared_length
  ) {
    (void)memset_s(buffer, used, 0, used);
    free(buffer);
    errno = declared_length > MAX_SECRET_BYTES ? EFBIG : EINVAL;
    return NULL;
  }

  memmove(buffer, buffer + FRAME_HEADER_BYTES, declared_length);
  (void)memset_s(
    buffer + declared_length,
    allocation_size - declared_length,
    0,
    allocation_size - declared_length
  );
  *length = declared_length;
  return buffer;
}

static int write_stdout(const uint8_t *bytes, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    ssize_t count = write(STDOUT_FILENO, bytes + offset, length - offset);
    if (count > 0) {
      offset += (size_t)count;
      continue;
    }
    if (count < 0 && errno == EINTR) continue;
    return 1;
  }
  return 0;
}

static int read_item(CFStringRef account, CFStringRef service, SecKeychainRef keychain) {
  CFMutableDictionaryRef query = make_query(account, service, keychain);
  if (query == NULL) return EXIT_UNAVAILABLE;
  CFDictionarySetValue(query, kSecMatchLimit, kSecMatchLimitOne);
  CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);

  CFTypeRef result = NULL;
  OSStatus status = SecItemCopyMatching(query, &result);
  CFRelease(query);
  if (status == errSecItemNotFound) return EXIT_NOT_FOUND;
  if (status != errSecSuccess || result == NULL || CFGetTypeID(result) != CFDataGetTypeID()) {
    release_if_present(result);
    return mapped_status(status);
  }

  CFDataRef data = (CFDataRef)result;
  int output_status = write_stdout(CFDataGetBytePtr(data), (size_t)CFDataGetLength(data));
  CFRelease(data);
  return output_status == 0 ? 0 : EXIT_UNAVAILABLE;
}

static int write_item(
  CFStringRef account,
  CFStringRef service,
  CFStringRef label,
  SecKeychainRef keychain,
  uint8_t *secret,
  size_t secret_length
) {
  CFDataRef data = CFDataCreate(kCFAllocatorDefault, secret, (CFIndex)secret_length);
  (void)memset_s(secret, secret_length, 0, secret_length);
  free(secret);
  SecAccessRef access = make_empty_access(label);
  CFMutableDictionaryRef query = make_query(account, service, keychain);
  if (data == NULL || access == NULL || query == NULL) {
    release_if_present(data);
    release_if_present(access);
    release_if_present(query);
    return EXIT_UNAVAILABLE;
  }

  CFMutableDictionaryRef updates = CFDictionaryCreateMutable(
    kCFAllocatorDefault,
    0,
    &kCFTypeDictionaryKeyCallBacks,
    &kCFTypeDictionaryValueCallBacks
  );
  if (updates == NULL) {
    CFRelease(data);
    CFRelease(access);
    CFRelease(query);
    return EXIT_UNAVAILABLE;
  }
  CFDictionarySetValue(updates, kSecValueData, data);
  CFDictionarySetValue(updates, kSecAttrAccess, access);
  CFDictionarySetValue(updates, kSecAttrLabel, label);

  OSStatus status = SecItemUpdate(query, updates);
  if (status == errSecItemNotFound) {
    CFMutableDictionaryRef addition = make_identity(account, service);
    if (addition == NULL) {
      status = errSecAllocate;
    } else {
      CFDictionarySetValue(addition, kSecUseKeychain, keychain);
      CFDictionarySetValue(addition, kSecValueData, data);
      CFDictionarySetValue(addition, kSecAttrAccess, access);
      CFDictionarySetValue(addition, kSecAttrLabel, label);
      CFDictionarySetValue(addition, kSecAttrDescription, CFSTR("Encrypted credential managed by ASC Studio"));
      status = SecItemAdd(addition, NULL);
      CFRelease(addition);
    }
  }

  CFRelease(updates);
  CFRelease(query);
  CFRelease(access);
  CFRelease(data);
  return status == errSecSuccess ? 0 : mapped_status(status);
}

static int remove_item(CFStringRef account, CFStringRef service, SecKeychainRef keychain) {
  CFMutableDictionaryRef query = make_query(account, service, keychain);
  if (query == NULL) return EXIT_UNAVAILABLE;
  OSStatus status = SecItemDelete(query);
  CFRelease(query);
  if (status == errSecItemNotFound) return EXIT_NOT_FOUND;
  return status == errSecSuccess ? 0 : mapped_status(status);
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "version") == 0) {
    static const uint8_t version[] = "asc-studio-keychain-helper-v2\n";
    return write_stdout(version, sizeof(version) - 1);
  }
  if (argc != 3 || !valid_account(argv[2])) return 2;

  const char *operation = argv[1];
  const int is_write = strcmp(operation, "write") == 0;
  if (!is_write && strcmp(operation, "read") != 0 && strcmp(operation, "remove") != 0) return 2;
  size_t secret_length = 0;
  uint8_t *secret = NULL;
  if (is_write) {
    secret = read_stdin(&secret_length);
    if (secret == NULL) return 2;
  }

  CFStringRef account = string_from_utf8(argv[2]);
  CFStringRef service = CFRetain(CFSTR("com.asc-studio.credentials"));
  CFStringRef label = label_for_account(argv[2]);
  SecKeychainRef keychain = NULL;
  OSStatus keychain_status = SecKeychainCopyDefault(&keychain);
  if (account == NULL || service == NULL || label == NULL) {
    release_if_present(account);
    release_if_present(service);
    release_if_present(label);
    release_if_present(keychain);
    if (secret != NULL) {
      (void)memset_s(secret, secret_length, 0, secret_length);
      free(secret);
    }
    return 2;
  }
  if (keychain_status != errSecSuccess || keychain == NULL) {
    CFRelease(account);
    CFRelease(service);
    CFRelease(label);
    release_if_present(keychain);
    if (secret != NULL) {
      (void)memset_s(secret, secret_length, 0, secret_length);
      free(secret);
    }
    return mapped_status(keychain_status);
  }

  int result;
  if (strcmp(operation, "read") == 0) result = read_item(account, service, keychain);
  else if (is_write) result = write_item(account, service, label, keychain, secret, secret_length);
  else if (strcmp(operation, "remove") == 0) result = remove_item(account, service, keychain);
  else result = 2;

  release_if_present(label);
  CFRelease(keychain);
  CFRelease(service);
  CFRelease(account);
  return result;
}
