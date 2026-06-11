package lk.resq.localhub.model.firmware;

import java.util.OptionalInt;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class FirmwareRequestIds {
    private static final Pattern REQUEST_ID_PATTERN = Pattern.compile("^req-(\\d+)-(\\d{4,})$");

    private FirmwareRequestIds() {
    }

    public static String format(int commandTypeId, int sequenceNumber) {
        return String.format("req-%d-%04d", commandTypeId, sequenceNumber);
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
            int sequenceNumber = Integer.parseInt(matcher.group(2));
            return java.util.Optional.of(new ParsedRequestId(commandTypeId, sequenceNumber));
        } catch (NumberFormatException error) {
            return java.util.Optional.empty();
        }
    }

    private record ParsedRequestId(int commandTypeId, int sequenceNumber) {
    }
}