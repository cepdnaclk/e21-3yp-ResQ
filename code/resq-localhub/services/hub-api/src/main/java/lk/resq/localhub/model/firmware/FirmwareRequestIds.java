package lk.resq.localhub.model.firmware;

import java.util.OptionalInt;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class FirmwareRequestIds {
    private static final Pattern REQUEST_ID_PATTERN = Pattern.compile("^req-(\\d+)-([A-Za-z0-9]+-)?(\\d{4,})$");

    private FirmwareRequestIds() {
    }

    public static String format(int commandTypeId, int sequenceNumber) {
        return String.format("req-%d-%04d", commandTypeId, sequenceNumber);
    }

    public static String format(int commandTypeId, String hubInstanceId, long sequenceNumber) {
        if (hubInstanceId == null || !hubInstanceId.matches("[0-9a-f]{8,12}")) {
            throw new IllegalArgumentException("hubInstanceId must be 8-12 lowercase hexadecimal characters");
        }
        if (sequenceNumber <= 0) {
            throw new IllegalArgumentException("sequenceNumber must be positive");
        }
        return String.format("req-%d-%s-%06d", commandTypeId, hubInstanceId, sequenceNumber);
    }

    public static boolean isValid(String requestId) {
        return parse(requestId).isPresent();
    }

    public static OptionalInt parseCommandTypeId(String requestId) {
        return parse(requestId).map(parsed -> OptionalInt.of(parsed.commandTypeId())).orElseGet(OptionalInt::empty);
    }

    private static java.util.Optional<ParsedRequestId> parse(String requestId) {
        if (requestId == null) {
            return java.util.Optional.empty();
        }

        Matcher matcher = REQUEST_ID_PATTERN.matcher(requestId);
        if (!matcher.matches()) {
            return java.util.Optional.empty();
        }

        try {
            int commandTypeId = Integer.parseInt(matcher.group(1));
            long sequenceNumber = Long.parseLong(matcher.group(3));
            return java.util.Optional.of(new ParsedRequestId(commandTypeId, sequenceNumber));
        } catch (NumberFormatException error) {
            return java.util.Optional.empty();
        }
    }

    private record ParsedRequestId(int commandTypeId, long sequenceNumber) {
    }
}
